FROM golang:1.26-alpine AS build
WORKDIR /src
COPY services/estimator-go/go.mod ./go.mod
COPY services/estimator-go/cmd ./cmd
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/estimator ./cmd/estimator

FROM alpine:3.22
RUN apk add --no-cache ca-certificates wget
COPY --from=build /out/estimator /usr/local/bin/estimator
ENV PORT=8002
EXPOSE 8002
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:8002/health/ready >/dev/null
ENTRYPOINT ["estimator"]
