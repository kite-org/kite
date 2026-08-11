package connector

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/rancher/remotedialer"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/klog/v2"
)

const registrationRefreshInterval = time.Minute

func Run(ctx context.Context, args []string) error {
	flags := flag.NewFlagSet("kite connector", flag.ContinueOnError)
	klog.InitFlags(flags)
	server := flags.String("server", "", "Kite server URL")
	token := flags.String("token", "", "Kite connector token")
	kubeconfig := flags.String("kubeconfig", "", "Path to kubeconfig file")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *server == "" {
		return errors.New("--server is required")
	}
	if *token == "" {
		return errors.New("--token is required")
	}

	serverURL, err := url.Parse(*server)
	if err != nil {
		return fmt.Errorf("invalid server URL: %w", err)
	}
	if serverURL.Fragment != "" {
		return errors.New("server URL must not contain a fragment")
	}
	if serverURL.Scheme != "http" && serverURL.Scheme != "https" {
		return errors.New("server URL must use http or https")
	}
	if serverURL.Host == "" {
		return errors.New("invalid connector server URL")
	}

	var config *rest.Config
	if *kubeconfig == "" {
		config, err = rest.InClusterConfig()
		if err != nil {
			return fmt.Errorf("load in-cluster Kubernetes configuration: %w", err)
		}
	} else {
		config, err = clientcmd.BuildConfigFromFlags("", *kubeconfig)
		if err != nil {
			return fmt.Errorf("load kubeconfig: %w", err)
		}
	}

	apiAddress, err := apiServerAddress(config.Host)
	if err != nil {
		return err
	}
	registrationURL := *serverURL
	registrationURL.Path = strings.TrimRight(registrationURL.Path, "/") + "/api/v1/connector/register"
	registrationURL.RawPath = ""
	registrationURL.RawQuery = ""
	connectURL := *serverURL
	if connectURL.Scheme == "http" {
		connectURL.Scheme = "ws"
	} else {
		connectURL.Scheme = "wss"
	}
	connectURL.Path = strings.TrimRight(connectURL.Path, "/") + "/api/v1/connector/connect"
	connectURL.RawPath = ""
	connectURL.RawQuery = ""

	client := &http.Client{Timeout: 30 * time.Second}
	go func() {
		ticker := time.NewTicker(registrationRefreshInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := registerConnector(ctx, client, registrationURL.String(), *token, config); err != nil {
					klog.Warningf("Failed to refresh connector registration: %v", err)
				}
			}
		}
	}()

	headers := http.Header{"Authorization": []string{"Bearer " + *token}}
	authorizer := func(network, address string) bool {
		return network == "tcp" && address == apiAddress
	}

	klog.Info("Kite connector started")
	for {
		err := registerConnector(ctx, client, registrationURL.String(), *token, config)
		if err == nil {
			err = remotedialer.ConnectToProxy(ctx, connectURL.String(), headers, authorizer, nil, nil)
		}
		if ctx.Err() != nil {
			return nil //nolint:nilerr // Context cancellation is a clean shutdown.
		}
		klog.Warningf("Kite connector unavailable: %v; retrying in 5 seconds", err)
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(5 * time.Second):
		}
	}
}

func apiServerAddress(host string) (string, error) {
	apiURL, err := url.Parse(host)
	if err != nil || apiURL.Hostname() == "" {
		return "", fmt.Errorf("invalid Kubernetes API URL %q", host)
	}
	port := apiURL.Port()
	if port == "" {
		switch apiURL.Scheme {
		case "http":
			port = "80"
		case "https":
			port = "443"
		default:
			return "", fmt.Errorf("Kubernetes API URL must use http or https")
		}
	}
	return net.JoinHostPort(apiURL.Hostname(), port), nil
}
