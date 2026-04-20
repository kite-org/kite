# Environment Variables

Kite supports several environment variables by default to change the default values of some configuration items.

- **KITE_CONFIG_FILE**: Path to the configuration file. Available in Kite `v0.10.0` and later. When set, Kite loads cluster, OAuth, LDAP, RBAC, and super user settings from this file. See [Configuration File](/config/config-file) for details.
- **KITE_USERNAME**: Legacy environment variable for the initial administrator username. It is only used for env-to-DB migration when `KITE_CONFIG_FILE` is not set.
- **KITE_PASSWORD**: Legacy environment variable for the initial administrator password. It is only used for env-to-DB migration when `KITE_CONFIG_FILE` is not set.
- **KUBECONFIG**: Legacy kubeconfig environment variable used to import clusters when `KITE_CONFIG_FILE` is not set.
- **ANONYMOUS_USER_ENABLED**: Enable anonymous user access, default value is `false`. When enabled, all access will no longer require authentication and will have the highest permissions by default.

- **JWT_SECRET**: Secret key used for signing and verifying JWT
- **KITE_ENCRYPT_KEY**: Secret key used for encrypting sensitive data, such as user passwords, OAuth clientSecret, kubeconfig, etc.

- **HOST**: Used for generating OAuth 2.0 authorization callback addresses, default will be obtained from request headers. If you find the result not as expected, you can manually configure this environment variable.

- **NODE_TERMINAL_IMAGE**: Docker image used for generating Node Terminal Agent.

- **ENABLE_ANALYTICS**: Enable data analytics functionality, default value is `false`. When enabled, Kite will collect limited data to help improve the product.

- **PORT**: Port on which Kite runs, default value is `8080`.
