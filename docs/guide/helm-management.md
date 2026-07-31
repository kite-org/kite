# Helm Management

Kite provides basic Helm management in the dashboard, covering chart discovery, release installation, upgrade, rollback, and uninstall.

## App Catalog

Open **App Catalog** from the sidebar to browse Helm charts.

Kite supports two chart sources:

- **Artifact Hub**: search public Helm charts.
- **Repositories**: browse Helm repositories managed in Kite.

::: tip
When using the Artifact Hub source, Kite may request Artifact Hub to fetch chart lists and chart details.
:::

::: warning
Kite only displays chart information and is not responsible for the chart content. Review chart details, templates, and values carefully before installing or upgrading.
:::

Users with the **admin** role can add or remove Helm repositories. Both classic (`https://`) and OCI (`oci://`) repositories are supported; an OCI URL must point at a single chart path without a tag or digest (for example `oci://registry.example.com/charts/app`), and its semver registry tags become the chart's versions. Removing a repository only removes it from Kite and does not uninstall existing releases.

Open a chart to view its README, values, templates, and versions. If the chart package is available, you can install it directly from Kite.

## Helm Releases

Open **Helm Release** from the sidebar to view installed releases.

The release detail page shows release status, chart version, values, resources, history, logs, and rendered manifests.

Kite supports dry-run previews before install and upgrade. You can upgrade a release from the detail page, roll back from the history tab, or delete a release to uninstall it from the cluster.

## Permissions

Repository management requires the **admin** role. Release operations are controlled by Kite RBAC through the `helmrelease` resource (`get`, `create`, `update`, `delete`).

::: warning
Grant `helmrelease` permissions carefully. Helm actions are executed by Kite with the cluster credentials configured in Kite, so users with `helmrelease` `create`, `update`, or `delete` permissions may create, update, or delete chart-rendered resources even if their own Kubernetes RBAC permissions would not allow those direct operations.

The cluster credentials configured in Kite also need enough Kubernetes permissions for the resources rendered by the chart.
:::
