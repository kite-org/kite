package middleware

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus"
)

var (
	httpRequestsTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Name: "http_requests_total",
			Help: "Total number of HTTP requests processed.",
		},
		[]string{"method", "route", "status"},
	)

	httpRequestDurationSeconds = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Name:    "http_request_duration_seconds",
			Help:    "HTTP request duration in seconds.",
			Buckets: prometheus.DefBuckets,
		},
		[]string{"method", "route", "status"},
	)
)

func init() {
	_ = prometheus.Register(httpRequestsTotal)
	_ = prometheus.Register(httpRequestDurationSeconds)
}

func Metrics() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		route := c.FullPath()
		if route == "" {
			route = c.Request.URL.Path
		}
		method := c.Request.Method
		if method == http.MethodOptions {
			return
		}
		for _, path := range unlogPath {
			if strings.HasPrefix(route, path) {
				return
			}
		}

		status := strconv.Itoa(c.Writer.Status())
		httpRequestsTotal.WithLabelValues(method, route, status).Inc()
		httpRequestDurationSeconds.WithLabelValues(method, route, status).Observe(time.Since(start).Seconds())
	}
}
