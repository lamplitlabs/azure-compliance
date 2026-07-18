"use client";

import Link from "next/link";
import { useState } from "react";
import { Menu } from "lucide-react";
import { LamplitLabsLogo } from "@/components/lamplit-labs-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Sheet, SheetTrigger, SheetContent, SheetTitle } from "@/components/ui/sheet";

const NAV_LINKS = [
  { label: "Compliance Matrix", href: "/", external: false, active: true },
  { label: "Products", href: "https://www.lamplitlabs.com/#products", external: true },
  { label: "About", href: "https://www.lamplitlabs.com/#about", external: true },
  { label: "Blog", href: "https://blogs.lamplitlabs.com", external: true },
  { label: "Contact", href: "https://www.lamplitlabs.com/#contact", external: true },
];

export function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
        {/* Logo */}
        <Link
          href="https://www.lamplitlabs.com"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 transition-opacity hover:opacity-80"
        >
          <LamplitLabsLogo className="h-7 w-7" />
          <span className="text-lg font-semibold tracking-tight">
            Lamplit Labs
          </span>
        </Link>

        {/* Desktop Nav */}
        <nav className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.label}
              href={link.href}
              {...(link.external
                ? { target: "_blank", rel: "noopener noreferrer" }
                : {})}
              className={`relative rounded-md px-3 py-2 text-sm transition-colors after:absolute after:bottom-0 after:left-1/2 after:h-[2px] after:bg-foreground after:transition-all after:duration-300 ${
                link.active
                  ? "text-foreground after:left-1 after:w-[calc(100%-8px)]"
                  : "text-muted-foreground hover:text-foreground after:w-0 hover:after:left-1 hover:after:w-[calc(100%-8px)]"
              }`}
            >
              {link.label}
            </Link>
          ))}
          <div className="ml-1">
            <ThemeToggle />
          </div>
        </nav>

        {/* Mobile Nav */}
        <div className="flex items-center gap-2 md:hidden">
          <ThemeToggle />
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9"
                  aria-label="Open menu"
                />
              }
            >
              <Menu className="h-5 w-5" />
            </SheetTrigger>
            <SheetContent side="right" className="w-64">
              <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
              <nav className="mt-8 flex flex-col gap-1">
                {NAV_LINKS.map((link) => (
                  <Link
                    key={link.label}
                    href={link.href}
                    {...(link.external
                      ? { target: "_blank", rel: "noopener noreferrer" }
                      : {})}
                    className={`rounded-md px-3 py-2 text-sm transition-colors ${
                      link.active
                        ? "font-medium text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => setOpen(false)}
                  >
                    {link.label}
                  </Link>
                ))}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
