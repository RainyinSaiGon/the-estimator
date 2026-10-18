package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"net"
	"net/mail"
	"net/smtp"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type smtpMailer struct {
	host     string
	port     string
	from     string
	username string
	password string
	rootCAs  *x509.CertPool
}

func newSMTPMailerFromEnvironment() (*smtpMailer, error) {
	host := strings.TrimSpace(os.Getenv("IDENTITY_SMTP_HOST"))
	port := strings.TrimSpace(os.Getenv("IDENTITY_SMTP_PORT"))
	from := strings.TrimSpace(os.Getenv("IDENTITY_SMTP_FROM"))
	username := os.Getenv("IDENTITY_SMTP_USERNAME")
	password := os.Getenv("IDENTITY_SMTP_PASSWORD")
	if host == "" || strings.ContainsAny(host, "/:@\r\n") || port == "" || username == "" || password == "" {
		return nil, errors.New("SMTP host, port, username, and password are required when identity email mode is smtp")
	}
	portNumber, err := strconv.Atoi(port)
	if err != nil || portNumber < 1 || portNumber > 65535 {
		return nil, errors.New("identity SMTP port is invalid")
	}
	parsedFrom, err := mail.ParseAddress(from)
	if err != nil || parsedFrom.Address == "" || strings.ContainsAny(from, "\r\n") {
		return nil, errors.New("identity SMTP sender address is invalid")
	}
	var roots *x509.CertPool
	if caFile := strings.TrimSpace(os.Getenv("IDENTITY_SMTP_CA_FILE")); caFile != "" {
		pem, err := os.ReadFile(caFile)
		if err != nil {
			return nil, errors.New("identity SMTP CA file could not be read")
		}
		roots, err = x509.SystemCertPool()
		if err != nil || roots == nil {
			roots = x509.NewCertPool()
		}
		if !roots.AppendCertsFromPEM(pem) {
			return nil, errors.New("identity SMTP CA file contains no certificates")
		}
	}
	return &smtpMailer{host: host, port: port, from: parsedFrom.Address, username: username, password: password, rootCAs: roots}, nil
}

func (mailer *smtpMailer) Send(ctx context.Context, recipient, subject, body string) error {
	dialer := net.Dialer{Timeout: 5 * time.Second}
	connection, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(mailer.host, mailer.port))
	if err != nil {
		return err
	}
	defer connection.Close()
	if deadline, ok := ctx.Deadline(); ok {
		_ = connection.SetDeadline(deadline)
	} else {
		_ = connection.SetDeadline(time.Now().Add(10 * time.Second))
	}
	client, err := smtp.NewClient(connection, mailer.host)
	if err != nil {
		return err
	}
	defer func() { _ = client.Close() }()
	if ok, _ := client.Extension("STARTTLS"); !ok {
		return errors.New("SMTP server does not offer STARTTLS")
	}
	if err := client.StartTLS(&tls.Config{ServerName: mailer.host, MinVersion: tls.VersionTLS12, RootCAs: mailer.rootCAs}); err != nil {
		return err
	}
	if err := client.Auth(smtp.PlainAuth("", mailer.username, mailer.password, mailer.host)); err != nil {
		return err
	}
	if err := client.Mail(mailer.from); err != nil {
		return err
	}
	if err := client.Rcpt(recipient); err != nil {
		return err
	}
	writer, err := client.Data()
	if err != nil {
		return err
	}
	message := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\nDate: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n%s\r\n", mailer.from, recipient, subject, time.Now().UTC().Format(time.RFC1123Z), strings.ReplaceAll(body, "\n", "\r\n"))
	if _, err := io.WriteString(writer, message); err != nil {
		_ = writer.Close()
		return err
	}
	if err := writer.Close(); err != nil {
		return err
	}
	return client.Quit()
}

func validPublicBaseURL(value string) bool {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.Path != "" {
		return false
	}
	if parsed.Scheme == "https" {
		return true
	}
	if parsed.Scheme != "http" {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}
