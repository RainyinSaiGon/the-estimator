FROM golang:1.26-alpine AS build
WORKDIR /src
COPY services/identity-go/go.mod ./go.mod
COPY services/identity-go/go.sum ./go.sum
COPY services/identity-go/cmd ./cmd
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/identity ./cmd/identity

FROM alpine:3.22
RUN apk add --no-cache ca-certificates wget
COPY --from=build /out/identity /usr/local/bin/identity
ENV HOST=0.0.0.0 PORT=8003 REQUEST_TIMEOUT=5s
EXPOSE 8003
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:8003/health/ready >/dev/null
ENTRYPOINT ["identity"]
