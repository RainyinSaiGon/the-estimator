FROM golang:1.26-alpine AS build
WORKDIR /src
COPY services/estimator-go/go.mod services/estimator-go/go.sum ./
COPY services/estimator-go/cmd ./cmd
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/estimator ./cmd/estimator

FROM alpine:3.22
RUN apk add --no-cache ca-certificates wget
COPY --from=build /out/estimator /usr/local/bin/estimator
ENV HOST=0.0.0.0 PORT=8002 REQUEST_TIMEOUT=8s
EXPOSE 8002
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:8002/health/ready >/dev/null
ENTRYPOINT ["estimator"]
