"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search, Check, Minus, Share2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type AzureComplianceReport,
  type CloudToggle,
  type ComplianceFilter,
  type FrameworkKey,
  type ReportFilter,
  type ServiceEntry,
} from "@/types/compliance";
import {
  DATA_URL,
  FRAMEWORK_KEYS,
  FRAMEWORK_LABELS,
  FRAMEWORK_FULL_NAMES,
} from "@/lib/constants";

function formatDateTime(dateStr: string | undefined): string {
  if (!dateStr || dateStr === "N/A") return "N/A";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return (
      d.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      }) +
      " " +
      d.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
      })
    );
  } catch {
    return dateStr;
  }
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/** Read initial filter values from URL query parameters (works on GitHub Pages). */
function getInitialFilters() {
  if (typeof window === "undefined") {
    return {
      search: "",
      cloud: "azure" as CloudToggle,
      report: "germanyC5" as ReportFilter,
      compliance: "all" as ComplianceFilter,
    };
  }
  const params = new URLSearchParams(window.location.search);
  const cloud = params.get("cloud");
  const report = params.get("report") || params.get("framework");
  return {
    search: params.get("q") || params.get("search") || "",
    cloud: (cloud === "gov" ? "gov" : "azure") as CloudToggle,
    report: (report && (report === "all" || FRAMEWORK_KEYS.includes(report as FrameworkKey))
      ? report
      : "germanyC5") as ReportFilter,
    compliance: (params.get("compliance") as ComplianceFilter) || "all",
  };
}

/** Update URL query parameters without reloading the page. */
function updateQueryParams(filters: {
  search: string;
  cloud: string;
  report: string;
  compliance: string;
}) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams();
  if (filters.search) params.set("q", filters.search);
  if (filters.cloud !== "azure") params.set("cloud", filters.cloud);
  if (filters.report !== "germanyC5") params.set("report", filters.report);
  if (filters.compliance !== "all")
    params.set("compliance", filters.compliance);

  const qs = params.toString();
  const newUrl = qs
    ? `${window.location.pathname}?${qs}`
    : window.location.pathname;
  window.history.replaceState(null, "", newUrl);
}

export function ComplianceMatrix() {
  const [data, setData] = useState<AzureComplianceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const initial = useMemo(() => getInitialFilters(), []);
  const [search, setSearch] = useState(initial.search);
  const [cloudToggle, setCloudToggle] = useState<CloudToggle>(initial.cloud);
  const [reportFilter, setReportFilter] = useState<ReportFilter>(
    initial.report
  );
  const [complianceFilter, setComplianceFilter] = useState<ComplianceFilter>(
    initial.compliance
  );

  const debouncedSearch = useDebounce(search, 200);

  // Sync filters to URL query params
  useEffect(() => {
    updateQueryParams({
      search: debouncedSearch,
      cloud: cloudToggle,
      report: reportFilter,
      compliance: complianceFilter,
    });
  }, [debouncedSearch, cloudToggle, reportFilter, complianceFilter]);

  // Auto-scroll to matrix section if query params are present
  useEffect(() => {
    if (
      initial.search ||
      initial.cloud !== "azure" ||
      initial.report !== "germanyC5" ||
      initial.compliance !== "all"
    ) {
      setTimeout(() => {
        document
          .getElementById("compliance-matrix")
          ?.scrollIntoView({ behavior: "smooth" });
      }, 300);
    }
  }, [initial]);

  const copyShareLink = useCallback(() => {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, []);

  useEffect(() => {
    async function loadData() {
      try {
        const resp = await fetch(DATA_URL);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json: AzureComplianceReport = await resp.json();
        setData(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  // Determine which framework columns to show
  const visibleFrameworks = useMemo<FrameworkKey[]>(() => {
    if (reportFilter === "all") return FRAMEWORK_KEYS;
    return [reportFilter];
  }, [reportFilter]);

  const filteredServices = useMemo(() => {
    if (!data) return [];

    return data.services.filter((svc) => {
      // Search filter
      if (
        debouncedSearch &&
        !svc.serviceName.toLowerCase().includes(debouncedSearch.toLowerCase())
      )
        return false;

      // Cloud-specific compliance data
      const cloudData =
        cloudToggle === "azure" ? svc.azure : svc.azureGovernment;

      // Compliance level filter
      if (complianceFilter !== "all") {
        const count = visibleFrameworks.filter((k) => cloudData[k]).length;
        const max = visibleFrameworks.length;

        if (complianceFilter === "compliant" && count < max) return false;
        if (complianceFilter === "partial" && (count === 0 || count === max))
          return false;
        if (complianceFilter === "none" && count > 0) return false;
      }

      return true;
    });
  }, [
    data,
    debouncedSearch,
    cloudToggle,
    complianceFilter,
    visibleFrameworks,
  ]);

  const lastCheck = data?.lastCheck || data?.generatedAt || "N/A";
  const lastSync = data?.lastSync || data?.generatedAt || "N/A";
  const disclaimer =
    data?.disclaimer ||
    "This data reflects Microsoft's platform-level compliance attestation scope as published in the official audit reports obtained from the Service Trust Portal. It does NOT constitute a compliance certification for any customer workload. Customers must independently assess their own control implementations.";

  return (
    <div id="compliance-matrix" className="flex flex-1 flex-col scroll-mt-14">
      {/* Page Title */}
      <div className="mx-auto w-full max-w-7xl px-4 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">
              Compliance Matrix
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Interactive compliance coverage matrix for Azure services across{" "}
              {FRAMEWORK_KEYS.length} frameworks.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 shrink-0"
            onClick={copyShareLink}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Share2 className="h-3.5 w-3.5" />
            )}
            {copied ? "Copied!" : "Share"}
          </Button>
        </div>
        {data && (
          <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
            <span>Last check: {formatDateTime(lastCheck)}</span>
            <span>Last sync: {formatDateTime(lastSync)}</span>
          </div>
        )}
      </div>

      {/* Toolbar */}
      <div className="mx-auto mt-4 flex w-full max-w-7xl flex-wrap items-center gap-3 px-4">
        {/* Search */}
        <div className="relative min-w-[250px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search Azure services..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Cloud Toggle */}
        <div className="inline-flex items-center rounded-lg border bg-muted p-0.5">
          <button
            onClick={() => setCloudToggle("azure")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
              cloudToggle === "azure"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="flex items-center gap-1.5">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  cloudToggle === "azure" ? "bg-blue-500" : "bg-blue-500/40"
                }`}
              />
              Azure
            </span>
          </button>
          <button
            onClick={() => setCloudToggle("gov")}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
              cloudToggle === "gov"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className="flex items-center gap-1.5">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  cloudToggle === "gov" ? "bg-purple-500" : "bg-purple-500/40"
                }`}
              />
              Azure Gov
            </span>
          </button>
        </div>

        {/* Compliance Report Selector (default: Germany C5) */}
        <Select
          value={reportFilter}
          onValueChange={(v) => {
            if (v !== null) setReportFilter(v as ReportFilter);
          }}
        >
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="Germany C5" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Frameworks</SelectItem>
            {FRAMEWORK_KEYS.map((key) => (
              <SelectItem key={key} value={key}>
                {FRAMEWORK_FULL_NAMES[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Compliance Filter */}
        <Select
          value={complianceFilter}
          onValueChange={(v) => {
            if (v) setComplianceFilter(v as ComplianceFilter);
          }}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Services" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Services</SelectItem>
            <SelectItem value="compliant">Fully Compliant</SelectItem>
            <SelectItem value="partial">Partially Compliant</SelectItem>
            <SelectItem value="none">No Compliance</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Stats */}
      {data && (
        <div className="mx-auto mt-3 flex w-full max-w-7xl flex-wrap gap-4 px-4 text-sm text-muted-foreground sm:gap-6">
          <span>
            Showing{" "}
            <span className="font-semibold text-foreground">
              {filteredServices.length}
            </span>{" "}
            of{" "}
            <span className="font-semibold text-foreground">
              {data.services.length}
            </span>{" "}
            services
          </span>
          <span>
            Frameworks:{" "}
            <span className="font-semibold text-foreground">
              {visibleFrameworks.length}
            </span>
            {reportFilter !== "all" && (
              <span className="text-xs"> of {FRAMEWORK_KEYS.length}</span>
            )}
          </span>
          <span>
            Cloud:{" "}
            <span className="font-semibold text-foreground">
              {cloudToggle === "azure" ? "Azure" : "Azure Government"}
            </span>
          </span>
        </div>
      )}

      {/* Table */}
      <div className="mx-auto mt-4 w-full max-w-7xl overflow-x-auto px-4 pb-6">
        {loading && (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <div className="mr-3 h-5 w-5 animate-spin rounded-full border-2 border-border border-t-foreground" />
            Loading compliance data...
          </div>
        )}

        {error && (
          <div className="py-12 text-center text-muted-foreground">
            Failed to load data.
            <br />
            <small>{error}</small>
          </div>
        )}

        {!loading && !error && filteredServices.length === 0 && (
          <div className="py-12 text-center text-muted-foreground">
            No services match your filters.
          </div>
        )}

        {!loading && !error && filteredServices.length > 0 && (
          <div className="rounded-lg border shadow-sm">
            <Table>
              <TableHeader>
                {/* Cloud indicator row */}
                <TableRow>
                  <TableHead
                    rowSpan={2}
                    className="sticky left-0 z-20 min-w-[220px] border-b-2 bg-background"
                  >
                    Service
                  </TableHead>
                  <TableHead
                    colSpan={visibleFrameworks.length}
                    className="border-b text-center text-xs uppercase tracking-wider"
                  >
                    <Badge
                      variant="secondary"
                      className={
                        cloudToggle === "azure"
                          ? "bg-blue-500/15 text-blue-400 dark:text-blue-300"
                          : "bg-purple-500/15 text-purple-400 dark:text-purple-300"
                      }
                    >
                      {cloudToggle === "azure" ? "Azure" : "Azure Government"}
                    </Badge>
                  </TableHead>
                </TableRow>

                {/* Framework header row */}
                <TableRow>
                  {visibleFrameworks.map((key) => (
                    <TableHead
                      key={key}
                      className="whitespace-nowrap text-center text-[0.65rem] font-semibold text-muted-foreground"
                      title={FRAMEWORK_FULL_NAMES[key]}
                    >
                      {FRAMEWORK_LABELS[key]}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>

              <TableBody>
                {filteredServices.map((svc) => {
                  const cloudData =
                    cloudToggle === "azure"
                      ? svc.azure
                      : svc.azureGovernment;
                  return (
                    <TableRow
                      key={svc.serviceName}
                      className="hover:bg-muted/50"
                    >
                      <TableCell className="sticky left-0 z-10 border-r-2 bg-background font-medium">
                        {svc.serviceName}
                      </TableCell>
                      {visibleFrameworks.map((key) => (
                        <ComplianceCell key={key} value={cloudData[key]} />
                      ))}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Disclaimer */}
      <div className="mx-auto w-full max-w-7xl px-4 pb-8">
        <div className="rounded-lg border bg-card p-4 text-sm leading-relaxed text-muted-foreground">
          <strong className="text-foreground">Disclaimer:</strong> {disclaimer}
        </div>
      </div>
    </div>
  );
}

function ComplianceCell({
  value,
  className,
}: {
  value: boolean;
  className?: string;
}) {
  return (
    <TableCell className={`text-center ${className || ""}`}>
      {value ? (
        <Check className="mx-auto h-4 w-4 text-green-500" />
      ) : (
        <Minus className="mx-auto h-3 w-3 text-muted-foreground/30" />
      )}
    </TableCell>
  );
}
