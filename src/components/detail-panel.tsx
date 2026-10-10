import type { ReactNode } from "react";
import { Drawer as Vaul } from "vaul";
import { ChevronDown, X } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

/**
 * Detailpaneel voor de hele app.
 * Telefoon: kaart die van onder opschuift (92% hoog), met greep, vegen naar beneden sluit,
 * en een duidelijke "Sluiten"-knop bovenaan, onder de statusbalk.
 * Desktop: paneel rechts met zichtbare sluitknop.
 */
export function DetailPanel({
  open,
  onClose,
  title,
  eyebrow,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  eyebrow?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const mobile = useIsMobile();
  return (
    <Vaul.Root
      open={open}
      onOpenChange={(o) => !o && onClose()}
      direction={mobile ? "bottom" : "right"}
      shouldScaleBackground={false}
    >
      <Vaul.Portal>
        <Vaul.Overlay className="fixed inset-0 z-50 bg-[#020812]/70 backdrop-blur-[6px]" />
        <Vaul.Content
          aria-describedby={undefined}
          className={cn(
            "fixed z-50 flex flex-col overflow-hidden outline-none",
            mobile
              ? "inset-x-0 bottom-0 h-[92dvh] rounded-t-[28px] border-t border-white/10"
              : "inset-y-3 right-3 w-[min(600px,calc(100vw-24px))] rounded-[28px] border border-white/10",
          )}
          style={{
            background:
              "radial-gradient(40rem 22rem at 0% 0%, rgb(20 184 166 / 14%), transparent 60%), radial-gradient(30rem 20rem at 100% 0%, rgb(14 165 233 / 12%), transparent 60%), #0d1d33",
            boxShadow: "0 -20px 60px -20px rgb(0 0 0 / 70%), inset 0 1px 0 0 rgb(255 255 255 / 8%)",
          }}
        >
          {mobile && (
            <div
              className="mx-auto mt-2.5 h-1.5 w-11 shrink-0 rounded-full bg-white/25"
              aria-hidden
            />
          )}
          <div className="flex shrink-0 items-center gap-3 px-5 pt-3 pb-2">
            <div className="min-w-0 flex-1">
              {eyebrow && (
                <div className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  {eyebrow}
                </div>
              )}
              <Vaul.Title className="sr-only">
                {typeof title === "string" ? title : "Details"}
              </Vaul.Title>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-3.5 text-sm font-semibold text-foreground transition-colors hover:bg-white/[0.12] active:scale-95"
            >
              {mobile ? <ChevronDown className="size-4" /> : <X className="size-4" />}
              Sluiten
            </button>
          </div>
          <div
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6"
            data-vaul-no-drag={mobile ? undefined : true}
          >
            {children}
          </div>
          {footer && (
            <div className="shrink-0 border-t border-white/10 bg-[#0d1d33]/90 px-5 pt-3 pb-[calc(env(safe-area-inset-bottom)+14px)] backdrop-blur-xl">
              {footer}
            </div>
          )}
        </Vaul.Content>
      </Vaul.Portal>
    </Vaul.Root>
  );
}
