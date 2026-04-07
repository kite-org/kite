import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router-dom'

import { getResourceCatalogEntry } from '@/lib/resource-catalog'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'

interface BreadcrumbSegment {
  label: string
  href?: string
}

export function DynamicBreadcrumb() {
  const location = useLocation()
  const { t } = useTranslation()

  const generateBreadcrumbs = (): BreadcrumbSegment[] => {
    const pathSegments = location.pathname.split('/').filter(Boolean)
    const breadcrumbs: BreadcrumbSegment[] = []

    if (pathSegments.length === 0) {
      return breadcrumbs
    }

    // Helper function to create breadcrumb item
    const createResourceBreadcrumb = (
      label: string,
      href?: string
    ): BreadcrumbSegment => {
      if (label === 'pvcs') {
        return { label: t('sidebar.short.pvcs'), href }
      }

      const resource = getResourceCatalogEntry(label)
      if (!resource) {
        return { label, href }
      }

      const titleKey = 'titleKey' in resource ? resource.titleKey : undefined
      const shortLabel =
        'shortLabel' in resource ? resource.shortLabel : undefined

      return {
        label: titleKey
          ? t(titleKey, {
              defaultValue: shortLabel || resource.pluralLabel,
            })
          : shortLabel || resource.pluralLabel,
        href,
      }
    }

    // Helper function to get safe link for segments
    const getSafeLink = (index: number): string | undefined => {
      const isLastSegment = index === pathSegments.length - 1
      if (isLastSegment) return undefined

      // Handle different path patterns
      if (pathSegments[0] === 'crds') {
        if (index === 0) return '/crds'
        if (index === 1) return `/crds/${pathSegments[1]}`
        if (index === 2) return `/crds/${pathSegments[1]}` // namespace links back to CRD list
        return undefined
      } else {
        // Regular resources: namespace should link back to resource list
        const isNamespace = pathSegments.length === 3 && index === 1
        if (isNamespace) return `/${pathSegments[0]}`
        return `/${pathSegments.slice(0, index + 1).join('/')}`
      }
    }

    const shouldHideLastSegment =
      pathSegments[0] === 'crds'
        ? pathSegments.length >= 3
        : pathSegments.length >= 2
    const visibleSegments = shouldHideLastSegment
      ? pathSegments.slice(0, -1)
      : pathSegments

    // Generate breadcrumbs for each visible path segment
    visibleSegments.forEach((segment, index) => {
      const href = getSafeLink(index)
      breadcrumbs.push(
        index === 0
          ? createResourceBreadcrumb(segment, href)
          : { label: segment, href }
      )
    })

    return breadcrumbs
  }

  const breadcrumbs = generateBreadcrumbs()

  return (
    <Breadcrumb className="hidden md:block">
      <BreadcrumbList>
        {breadcrumbs.map((crumb, index) => (
          <div key={index} className="flex items-center">
            {index > 0 && <BreadcrumbSeparator />}
            <BreadcrumbItem>
              {crumb.href && index < breadcrumbs.length - 1 ? (
                <BreadcrumbLink asChild>
                  <Link to={crumb.href}>{crumb.label}</Link>
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </div>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
