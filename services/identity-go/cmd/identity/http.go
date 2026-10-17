package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"
)

func (store *identityStore) withBFFAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		provided := strings.TrimSpace(r.Header.Get("x-identity-bff-secret"))
		if len(provided) != len(store.bffSecret) || subtle.ConstantTimeCompare([]byte(provided), store.bffSecret) != 1 {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "The identity request could not be authenticated."})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func requestLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		requestID := requestIDFromHeader(r.Header.Get("x-request-id"))
		wrapped := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(wrapped, r.WithContext(context.WithValue(r.Context(), requestIDKey{}, requestID)))
		attributes := []any{"service", "identity-go", "request_id", requestID, "method", r.Method, "path", r.URL.Path, "status", wrapped.status, "duration_ms", float64(time.Since(started).Microseconds()) / 1000}
		if wrapped.status >= 500 {
			slog.Error("http_request", attributes...)
		} else {
			slog.Info("http_request", attributes...)
		}
	})
}

func jsonTimeoutHandler(timeout time.Duration, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), timeout)
		defer cancel()
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	if !strings.HasPrefix(strings.ToLower(r.Header.Get("content-type")), "application/json") {
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{"error": "Use a JSON request."})
		return false
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8*1024)
	defer r.Body.Close()
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "The identity request is invalid."})
		return false
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "The identity request is invalid."})
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("content-type", "application/json; charset=utf-8")
	w.Header().Set("cache-control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *statusWriter) Write(body []byte) (int, error) {
	return w.ResponseWriter.Write(body)
}

type requestIDKey struct{}

func requestIDFromHeader(value string) string {
	value = strings.TrimSpace(value)
	if len(value) > 64 || strings.ContainsAny(value, "\r\n") {
		return "untrusted"
	}
	if value == "" {
		return "missing"
	}
	return value
}

func remoteHost(remoteAddr string) string {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		return "unknown"
	}
	return host
}
