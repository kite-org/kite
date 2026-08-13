package clusteragent

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/rancher/remotedialer"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/klog/v2"
)

const registrationRefreshInterval = 10 * time.Minute

func Run(ctx context.Context, args []string) error {
	flags := flag.NewFlagSet("kite cluster-agent", flag.ContinueOnError)
	klog.InitFlags(flags)
	server := flags.String("server", "", "Kite server URL")
	token := flags.String("token", "", "Kite cluster agent token")
	publicKey := flags.String("public-key", "", "Kite cluster agent registration public key")
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
	if *publicKey == "" {
		return errors.New("--public-key is required")
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
		return errors.New("invalid cluster agent server URL")
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

	registrationURL := *serverURL
	registrationURL.Path = strings.TrimRight(registrationURL.Path, "/") + "/api/v1/cluster-agent/register"
	registrationURL.RawPath = ""
	registrationURL.RawQuery = ""
	connectURL := *serverURL
	if connectURL.Scheme == "http" {
		connectURL.Scheme = "ws"
	} else {
		connectURL.Scheme = "wss"
	}
	connectURL.Path = strings.TrimRight(connectURL.Path, "/") + "/api/v1/cluster-agent/connect"
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
				if err := registerClusterAgent(ctx, client, registrationURL.String(), *token, *publicKey, config); err != nil {
					klog.Warningf("Failed to refresh cluster agent registration: %v", err)
				}
			}
		}
	}()

	headers := http.Header{"Authorization": []string{"Bearer " + *token}}
	authorizer := func(network, _ string) bool {
		return network == "tcp"
	}

	klog.Info("Kite cluster agent started")
	for {
		err := registerClusterAgent(ctx, client, registrationURL.String(), *token, *publicKey, config)
		if err == nil {
			err = remotedialer.ConnectToProxy(ctx, connectURL.String(), headers, authorizer, nil, nil)
		}
		if ctx.Err() != nil {
			return nil //nolint:nilerr // Context cancellation is a clean shutdown.
		}
		klog.Warningf("Kite cluster agent unavailable: %v; retrying in 5 seconds", err)
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(5 * time.Second):
		}
	}
}
