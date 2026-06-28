FROM golang:1.25-alpine AS build

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/normalize ./cmd/normalize

FROM alpine:3.22

RUN adduser -D -H -u 10002 appuser
WORKDIR /app

COPY --from=build /out/normalize /app/normalize

USER appuser

CMD ["/app/normalize"]
