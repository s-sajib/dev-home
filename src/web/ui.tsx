import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import * as Switch from "@radix-ui/react-switch";
import * as ToggleGroup from "@radix-ui/react-toggle-group";
import * as Tooltip from "@radix-ui/react-tooltip";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useId, type ReactNode } from "react";
import { XIcon, useIconHover } from "./icons";

/**
 * Radix gives behaviour and accessibility, Motion gives movement, styles.css gives the look.
 * Motion's reduced-motion setting follows the OS: transforms and layout animations switch off.
 */
export const ease = [0.2, 0.7, 0.2, 1] as const;
export const spring = { type: "spring", stiffness: 520, damping: 38 } as const;

export const UiProvider = ({ children }: { children: ReactNode }) => (
  <MotionConfig reducedMotion="user" transition={{ duration: 0.24, ease }}>
    <Tooltip.Provider delayDuration={350} skipDelayDuration={250}>{children}</Tooltip.Provider>
  </MotionConfig>
);

export function Tip({ label, keyHint, children }: { label?: string; keyHint?: string; children: ReactNode }) {
  if (!label && !keyHint) return <>{children}</>;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tip" sideOffset={6} collisionPadding={8}>
          {label}{keyHint && <kbd>{keyHint}</kbd>}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/** Centered dialog: focus trapped, Esc/outside click close, titled for screen readers, animated in and out. */
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal forceMount>
        <AnimatePresence>
          {open && (
            <div key="modal">
              <Dialog.Overlay asChild forceMount>
                <motion.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
              </Dialog.Overlay>
              <div className="sheetwrap">
                <Dialog.Content asChild forceMount aria-describedby={undefined}>
                  <motion.div className="sheet" style={wide ? { maxWidth: 640 } : undefined} initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.985 }}>
                    <Dialog.Title asChild><h3>{title}</h3></Dialog.Title>
                    {children}
                  </motion.div>
                </Dialog.Content>
              </div>
            </div>
          )}
        </AnimatePresence>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal forceMount>
        <AnimatePresence>
          {open && (
            <div key="drawer">
              <Dialog.Overlay asChild forceMount>
                <motion.div className="overlay light" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
              </Dialog.Overlay>
              <Dialog.Content asChild forceMount aria-describedby={undefined}>
                <motion.aside className="drawer" data-testid="drawer" initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 32, opacity: 0 }} transition={{ type: "spring", stiffness: 380, damping: 36 }}>
                  <Dialog.Title className="vh">{title}</Dialog.Title>
                  <CloseButton />
                  {children}
                </motion.aside>
              </Dialog.Content>
            </div>
          )}
        </AnimatePresence>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Menu({ label, trigger, children }: { label: string; trigger: ReactNode; children: ReactNode }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild><button className="caret" aria-label={label}>{trigger}</button></Popover.Trigger>
      <Popover.Portal>
        <Popover.Content asChild aria-label={label} sideOffset={8} align="start" collisionPadding={12}>
          <motion.div className="panel" initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}>{children}</motion.div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Single-choice segmented control (radio semantics, arrow keys) with a pill that slides between options. */
export function Segmented<T extends string>({ value, onChange, items, disabled, label, children }: {
  value: T | undefined; onChange: (v: T) => void; items: { value: T; label: ReactNode; tone?: string }[]; disabled?: boolean; label: string; children?: ReactNode;
}) {
  const id = useId();
  return (
    <ToggleGroup.Root type="single" className="seg" value={value} onValueChange={(v) => v && onChange(v as T)} disabled={disabled} aria-label={label}>
      {items.map((it) => (
        <ToggleGroup.Item key={it.value} value={it.value} className={it.tone ?? ""}>
          {value === it.value && <motion.span layoutId={id} className={`seg-pill ${it.tone ?? ""}`} transition={spring} />}
          <span className="seg-label">{it.label}</span>
        </ToggleGroup.Item>
      ))}
      {children}
    </ToggleGroup.Root>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="toggle">
      <Switch.Root className="switch" checked={checked} onCheckedChange={onChange}><motion.span layout transition={spring} className="thumb" /></Switch.Root>
      <span>{label}</span>
    </label>
  );
}

function CloseButton() {
  const h = useIconHover();
  return <Dialog.Close className="pill x" aria-label="Close" {...h.triggerProps}><XIcon ref={h.ref} size={14} />Close</Dialog.Close>;
}
