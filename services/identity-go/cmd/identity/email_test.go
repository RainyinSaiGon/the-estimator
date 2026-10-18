package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestValidPublicBaseURL(t *testing.T) {
	for _, value := range []string{"http://localhost:3000", "http://127.0.0.1:3000", "https://estimator.example.test"} {
		if !validPublicBaseURL(value) {
			t.Errorf("validPublicBaseURL(%q) = false", value)
		}
	}
	for _, value := range []string{"", "http://estimator.example.test", "ftp://localhost", "https://user:pass@example.test", "https://example.test/path", "https://example.test?token=secret"} {
		if validPublicBaseURL(value) {
			t.Errorf("validPublicBaseURL(%q) = true", value)
		}
	}
}

func TestSMTPMailerUsesVerifiedStartTLSBeforeAuthentication(t *testing.T) {
	certificate, roots := testSMTPCertificate(t)
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	port := strconv.Itoa(listener.Addr().(*net.TCPAddr).Port)
	authenticated := make(chan bool, 1)
	go serveTestSMTP(listener, certificate, true, authenticated)

	mailer := &smtpMailer{host: "localhost", port: port, from: "sender@example.test", username: "local-user", password: "local-password", rootCAs: roots}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := mailer.Send(ctx, "recipient@example.test", "Verify account", "https://localhost/verify#token=synthetic"); err != nil {
		t.Fatalf("Send() error = %v", err)
	}
	select {
	case ok := <-authenticated:
		if !ok {
			t.Fatal("SMTP authentication occurred before a verified TLS connection")
		}
	case <-time.After(time.Second):
		t.Fatal("SMTP server did not observe authentication")
	}
}

func TestSMTPMailerRejectsServerWithoutStartTLS(t *testing.T) {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	port := strconv.Itoa(listener.Addr().(*net.TCPAddr).Port)
	authenticated := make(chan bool, 1)
	go serveTestSMTP(listener, tls.Certificate{}, false, authenticated)
	mailer := &smtpMailer{host: "localhost", port: port, from: "sender@example.test", username: "local-user", password: "local-password"}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := mailer.Send(ctx, "recipient@example.test", "Verify account", "body"); err == nil {
		t.Fatal("expected SMTP without STARTTLS to be rejected")
	}
	select {
	case ok := <-authenticated:
		if ok {
			t.Fatal("mailer authenticated before requiring STARTTLS")
		}
	default:
	}
}

func serveTestSMTP(listener net.Listener, certificate tls.Certificate, offerStartTLS bool, authenticated chan<- bool) {
	connection, err := listener.Accept()
	if err != nil {
		return
	}
	defer connection.Close()
	_, _ = fmt.Fprint(connection, "220 localhost ESMTP ready\r\n")
	secure := false
	reader := bufio.NewReader(connection)
	for {
		line, readErr := reader.ReadString('\n')
		if readErr != nil {
			return
		}
		command := strings.ToUpper(strings.TrimSpace(line))
		switch {
		case strings.HasPrefix(command, "EHLO "):
			if offerStartTLS && !secure {
				_, _ = fmt.Fprint(connection, "250-localhost\r\n250-STARTTLS\r\n250 AUTH PLAIN\r\n")
			} else {
				_, _ = fmt.Fprint(connection, "250-localhost\r\n250 AUTH PLAIN\r\n")
			}
		case command == "STARTTLS" && offerStartTLS && !secure:
			_, _ = fmt.Fprint(connection, "220 Begin TLS\r\n")
			tlsConnection := tls.Server(connection, &tls.Config{Certificates: []tls.Certificate{certificate}, MinVersion: tls.VersionTLS12})
			if tlsConnection.Handshake() != nil {
				return
			}
			connection = tlsConnection
			reader = bufio.NewReader(connection)
			secure = true
		case strings.HasPrefix(command, "AUTH PLAIN"):
			if !secure {
				authenticated <- false
				_, _ = fmt.Fprint(connection, "530 STARTTLS required\r\n")
				return
			}
			authenticated <- true
			_, _ = fmt.Fprint(connection, "235 authenticated\r\n")
		case strings.HasPrefix(command, "MAIL FROM:") || strings.HasPrefix(command, "RCPT TO:"):
			_, _ = fmt.Fprint(connection, "250 accepted\r\n")
		case command == "DATA":
			_, _ = fmt.Fprint(connection, "354 send data\r\n")
			for {
				data, dataErr := reader.ReadString('\n')
				if dataErr != nil {
					return
				}
				if strings.TrimSpace(data) == "." {
					break
				}
			}
			_, _ = fmt.Fprint(connection, "250 queued\r\n")
		case command == "QUIT":
			_, _ = fmt.Fprint(connection, "221 bye\r\n")
			return
		default:
			_, _ = fmt.Fprint(connection, "250 ok\r\n")
		}
	}
}

func testSMTPCertificate(t *testing.T) (tls.Certificate, *x509.CertPool) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "localhost"},
		DNSNames:              []string{"localhost"},
		NotBefore:             time.Now().Add(-time.Minute),
		NotAfter:              time.Now().Add(time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment | x509.KeyUsageCertSign,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		IsCA:                  true,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	certificatePEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
	certificate, err := tls.X509KeyPair(certificatePEM, keyPEM)
	if err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(certificatePEM) {
		t.Fatal("could not trust generated SMTP test certificate")
	}
	return certificate, roots
}
