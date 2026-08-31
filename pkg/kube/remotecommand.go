package kube

import (
	"net/http"
	"net/url"
	"time"

	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/remotecommand"
	clientgospdy "k8s.io/client-go/transport/spdy"
	"k8s.io/streaming/pkg/httpstream"
	httpstreamspdy "k8s.io/streaming/pkg/httpstream/spdy"
)

func newRemoteCommandExecutor(config *rest.Config, targetURL *url.URL) (remotecommand.Executor, error) {
	spdyExecutor, err := newSPDYExecutor(config, targetURL)
	if err != nil {
		return nil, err
	}
	if config.Dial != nil {
		return spdyExecutor, nil
	}

	websocketExecutor, err := remotecommand.NewWebSocketExecutor(config, http.MethodGet, targetURL.String())
	if err != nil {
		return nil, err
	}
	return remotecommand.NewFallbackExecutor(websocketExecutor, spdyExecutor, func(err error) bool {
		return httpstream.IsUpgradeFailure(err) || httpstream.IsHTTPSProxyError(err)
	})
}

func newSPDYExecutor(config *rest.Config, targetURL *url.URL) (remotecommand.Executor, error) {
	if config.Dial == nil {
		return remotecommand.NewSPDYExecutor(config, http.MethodPost, targetURL)
	}

	tlsConfig, err := rest.TLSConfigFor(config)
	if err != nil {
		return nil, err
	}
	upgradeRoundTripper, err := httpstreamspdy.NewRoundTripperWithConfig(httpstreamspdy.RoundTripperConfig{
		PingPeriod: 5 * time.Second,
		UpgradeTransport: &http.Transport{
			DialContext:     config.Dial,
			TLSClientConfig: tlsConfig,
		},
	})
	if err != nil {
		return nil, err
	}
	wrapper, err := rest.HTTPWrappersForConfig(config, upgradeRoundTripper)
	if err != nil {
		return nil, err
	}
	return remotecommand.NewSPDYExecutorForTransports(wrapper, clientgospdy.NewUpgraderForStreaming(upgradeRoundTripper), http.MethodPost, targetURL)
}
