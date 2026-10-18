package main

import (
	"context"
	"embed"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

//go:embed migrations/001_identity.sql
var migrationFiles embed.FS

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{ReplaceAttr: func(_ []string, attr slog.Attr) slog.Attr {
		switch attr.Key {
		case slog.TimeKey:
			return slog.String("timestamp", attr.Value.Time().UTC().Format(time.RFC3339Nano))
		case slog.LevelKey:
			return slog.String("severity", strings.ToLower(attr.Value.String()))
		case slog.MessageKey:
			return slog.String("event", attr.Value.String())
		default:
			return attr
		}
	}})))

	requestTimeout, err := configuredTimeout(os.Getenv("REQUEST_TIMEOUT"), 5*time.Second, 30*time.Second)
	if err != nil {
		slog.Error("invalid_server_configuration", "service", "identity-go", "setting", "REQUEST_TIMEOUT")
		os.Exit(2)
	}
	store, err := openIdentityStore(migrationFiles)
	if err != nil {
		slog.Error("identity_store_startup_failed", "service", "identity-go", "reason", err.Error())
		os.Exit(2)
	}
	defer store.close()

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health/live", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /health/ready", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := store.pool.Ping(ctx); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "not_ready"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ready", "service": "identity-go"})
	})
	mux.Handle("POST /v1/accounts", store.withBFFAuth(http.HandlerFunc(store.registerAccount)))
	mux.Handle("POST /v1/sessions", store.withBFFAuth(http.HandlerFunc(store.createSession)))
	mux.Handle("GET /v1/session", store.withBFFAuth(http.HandlerFunc(store.currentSession)))
	mux.Handle("POST /v1/session/renew", store.withBFFAuth(http.HandlerFunc(store.renewSession)))
	mux.Handle("DELETE /v1/session", store.withBFFAuth(http.HandlerFunc(store.revokeSession)))

	host := strings.TrimSpace(os.Getenv("HOST"))
	if host == "" {
		host = "127.0.0.1"
	}
	port := strings.TrimSpace(os.Getenv("PORT"))
	if port == "" {
		port = "8003"
	}
	server := &http.Server{
		Addr:              net.JoinHostPort(host, port),
		Handler:           requestLogging(jsonTimeoutHandler(requestTimeout, mux)),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       requestTimeout,
		WriteTimeout:      requestTimeout + time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 20,
	}
	shutdownContext, stopSignals := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stopSignals()
	go func() {
		<-shutdownContext.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(ctx)
	}()
	go func() {
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-shutdownContext.Done():
				return
			case <-ticker.C:
				ctx, cancel := context.WithTimeout(shutdownContext, 3*time.Second)
				if err := store.pruneLoginAttempts(ctx); err != nil {
					slog.Warn("identity_login_attempt_cleanup_failed", "service", "identity-go", "reason", err.Error())
				}
				cancel()
			}
		}
	}()
	slog.Info("service_starting", "service", "identity-go", "address", server.Addr)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("service_stopped", "service", "identity-go", "reason", err.Error())
		os.Exit(1)
	}
}

func configuredTimeout(value string, fallback, maximum time.Duration) (time.Duration, error) {
	if strings.TrimSpace(value) == "" {
		return fallback, nil
	}
	timeout, err := time.ParseDuration(value)
	if err != nil || timeout < 100*time.Millisecond || timeout > maximum {
		return 0, errors.New("request timeout is outside the allowed range")
	}
	return timeout, nil
}
