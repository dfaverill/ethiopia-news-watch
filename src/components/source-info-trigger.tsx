"use client";

import Image from "next/image";
import Link from "next/link";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, X } from "lucide-react";

import type { SourceName } from "@/lib/dashboard";
import { SOURCE_ICON_PATHS, getSourceIconImageClass } from "@/lib/source-branding";
import { getSourceProfile } from "@/lib/source-profiles";

interface SourceInfoTriggerProps {
  source: SourceName;
  children: ReactNode;
  buttonClassName?: string;
}

interface PanelLayout {
  left: number;
  top: number;
  width: number;
}

const PANEL_EDGE_PADDING = 12;
const PANEL_WIDTH = 440;
const PANEL_ESTIMATED_HEIGHT = 430;

function clampPanelLayout(layout: PanelLayout): PanelLayout {
  const width = Math.min(layout.width, window.innerWidth - PANEL_EDGE_PADDING * 2);
  const estimatedHeight = Math.min(
    PANEL_ESTIMATED_HEIGHT,
    window.innerHeight - PANEL_EDGE_PADDING * 2,
  );
  const minLeft = PANEL_EDGE_PADDING;
  const maxLeft = Math.max(minLeft, window.innerWidth - width - PANEL_EDGE_PADDING);
  const maxTop = Math.max(
    PANEL_EDGE_PADDING,
    window.innerHeight - estimatedHeight - PANEL_EDGE_PADDING,
  );

  return {
    width,
    left: Math.min(Math.max(layout.left, minLeft), maxLeft),
    top: Math.min(Math.max(layout.top, PANEL_EDGE_PADDING), maxTop),
  };
}

function buildPanelLayout(): PanelLayout {
  const horizontalPadding = 12;
  const estimatedHeight = Math.min(
    PANEL_ESTIMATED_HEIGHT,
    window.innerHeight - horizontalPadding * 2,
  );
  const width = Math.min(PANEL_WIDTH, window.innerWidth - horizontalPadding * 2);
  const left = (window.innerWidth - width) / 2;
  const top = (window.innerHeight - estimatedHeight) / 2;

  return clampPanelLayout({
    left,
    top,
    width,
  });
}

export function SourceInfoTrigger({
  source,
  children,
  buttonClassName,
}: SourceInfoTriggerProps) {
  const profile = getSourceProfile(source);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [panelLayout, setPanelLayout] = useState<PanelLayout | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleResize = () => {
      setPanelLayout((current) => (current ? clampPanelLayout(current) : current));
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;

      if (
        (buttonRef.current && buttonRef.current.contains(target)) ||
        (panelRef.current && panelRef.current.contains(target))
      ) {
        return;
      }

      setIsOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const handleDragStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!panelRef.current) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target?.closest("[data-source-info-no-drag='true']")) {
      return;
    }

    const panelRect = panelRef.current.getBoundingClientRect();
    dragStateRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - panelRect.left,
      offsetY: event.clientY - panelRect.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleDragMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;

    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    setPanelLayout((current) => {
      const width = current?.width ?? PANEL_WIDTH;

      return clampPanelLayout({
        width,
        left: event.clientX - dragState.offsetX,
        top: event.clientY - dragState.offsetY,
      });
    });
  };

  const handleDragEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStateRef.current || dragStateRef.current.pointerId !== event.pointerId) {
      return;
    }

    dragStateRef.current = null;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  let panel = null;

  if (typeof document !== "undefined" && isOpen && panelLayout) {
    const iconPath = SOURCE_ICON_PATHS[source];
    const panelStyle: CSSProperties = {
      position: "fixed",
      left: panelLayout.left,
      top: panelLayout.top,
      width: panelLayout.width,
      zIndex: 80,
    };

    panel = createPortal(
      <div style={panelStyle}>
        <div
          ref={panelRef}
          className="flex max-h-[min(70vh,640px)] flex-col overflow-hidden rounded-[28px] border border-[color:var(--line-strong)] bg-[color:var(--card)] shadow-[0_28px_90px_rgba(15,23,42,0.26)] backdrop-blur"
        >
          <div
            className="flex cursor-grab items-start justify-between gap-4 border-b border-[color:var(--line)] px-5 py-4 active:cursor-grabbing"
            onPointerDown={handleDragStart}
            onPointerMove={handleDragMove}
            onPointerUp={handleDragEnd}
            onPointerCancel={handleDragEnd}
          >
            <div className="flex min-w-0 items-start gap-3">
              <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[color:var(--line-strong)] bg-[color:var(--card-elevated)]">
                {iconPath ? (
                  <Image
                    src={iconPath}
                    alt=""
                    width={44}
                    height={44}
                    unoptimized
                    className={`h-full w-full ${getSourceIconImageClass(source)}`}
                  />
                ) : null}
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--accent)]">
                  Source explainer
                </p>
                <h3 className="mt-1 font-headline text-2xl font-semibold text-[color:var(--ink)]">
                  {source}
                </h3>
                <p className="mt-1 text-sm leading-6 text-[color:var(--ink-soft)]">
                  {profile.typeLabel}
                </p>
              </div>
            </div>
            <button
              data-source-info-no-drag="true"
              type="button"
              onClick={() => setIsOpen(false)}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[color:var(--line)] bg-[color:var(--card-elevated)] text-[color:var(--ink-soft)] transition hover:text-[color:var(--ink)]"
              aria-label={`Close ${source} explainer`}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
            <div className="space-y-5">
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex rounded-full border border-[color:var(--line)] bg-[color:var(--card-elevated)] px-3 py-1 text-[11px] font-medium text-[color:var(--ink-soft)]">
                  {profile.languagesLabel}
                </span>
                <span className="inline-flex rounded-full border border-[color:var(--line)] bg-[color:var(--card-elevated)] px-3 py-1 text-[11px] font-medium text-[color:var(--ink-soft)]">
                  {profile.coreCoverageLabel}
                </span>
              </div>

              <div className="space-y-4 text-sm leading-7 text-[color:var(--ink-soft)]">
                <p>{profile.overview}</p>
                <p>{profile.influence}</p>
                <p>{profile.whyTracked}</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-[20px] border border-[color:var(--line)] bg-[color:var(--card-elevated)] px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
                    Where it matters most
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[color:var(--ink)]">
                    {profile.popularityLabel}
                  </p>
                </div>
                <div className="rounded-[20px] border border-[color:var(--line)] bg-[color:var(--card-elevated)] px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[color:var(--ink-soft)]">
                    Why it is in this app
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[color:var(--ink)]">
                    We watch it because it adds a distinct lens to Ethiopia coverage, not just another headline feed.
                  </p>
                </div>
              </div>

              <div className="rounded-[20px] border border-[color:var(--line)] bg-[color:var(--card-elevated)] px-4 py-3 text-sm leading-6 text-[color:var(--ink-soft)]">
                Drag this panel if you want to move it. Scrolling the page will leave it where it opened until you come back to it.
              </div>

              <div className="flex flex-col gap-3 border-t border-[color:var(--line)] pt-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm leading-6 text-[color:var(--ink-soft)]">
                  <p className="font-medium text-[color:var(--ink)]">Official site</p>
                  <p>{new URL(profile.officialUrl).hostname}</p>
                </div>
                <Link
                  href={profile.officialUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-[color:var(--line-strong)] bg-[color:var(--card-elevated)] px-4 py-2 text-sm font-semibold text-[color:var(--ink)] transition hover:bg-white hover:text-black"
                >
                  Open official site
                  <ExternalLink className="h-4 w-4" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          if (isOpen) {
            setIsOpen(false);
            return;
          }

          setPanelLayout(buildPanelLayout());
          setIsOpen(true);
        }}
        className={buttonClassName}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        title={`Read about ${source}`}
      >
        {children}
      </button>
      {panel}
    </>
  );
}
