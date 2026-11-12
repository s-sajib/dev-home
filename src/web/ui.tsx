import * as Dialog from "@radix-ui/react-dialog";
import * as Popover from "@radix-ui/react-popover";
import * as Switch from "@radix-ui/react-switch";
import * as ToggleGroup from "@radix-ui/react-toggle-group";
import * as Tooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

/** Thin wrappers over Radix primitives: behaviour and accessibility from Radix, look from styles.css. */

export const TipProvider = ({ children }: { children: ReactNode }) => (
  <Tooltip.Provider delayDuration={350} skipDelayDuration={250}>{children}</Tooltip.Provider>
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

/** Centered dialog. Focus is trapped, Esc and outside click close it, screen readers get a title. */
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay" />
        <Dialog.Content className="sheet" style={wide ? { maxWidth: 640 } : undefined} aria-describedby={undefined}>
          <Dialog.Title asChild><h3>{title}</h3></Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Side drawer built on the same dialog primitive. */
export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="overlay light" />
        <Dialog.Content className="drawer" data-testid="drawer" aria-describedby={undefined}>
          <Dialog.Title className="vh">{title}</Dialog.Title>
          <Dialog.Close className="pill x">Close</Dialog.Close>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Menu({ label, trigger, children }: { label: string; trigger: ReactNode; children: ReactNode }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild><button className="caret" aria-label={label}>{trigger}</button></Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="panel" aria-label={label} sideOffset={8} align="start" collisionPadding={12}>{children}</Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Single-choice segmented control (radio semantics, arrow-key navigation). */
export function Segmented<T extends string>({ value, onChange, items, disabled, label, children }: {
  value: T | undefined; onChange: (v: T) => void; items: { value: T; label: ReactNode; tone?: string }[]; disabled?: boolean; label: string; children?: ReactNode;
}) {
  return (
    <ToggleGroup.Root type="single" className="seg" value={value} onValueChange={(v) => v && onChange(v as T)} disabled={disabled} aria-label={label}>
      {items.map((it) => <ToggleGroup.Item key={it.value} value={it.value} className={it.tone ?? ""}>{it.label}</ToggleGroup.Item>)}
      {children}
    </ToggleGroup.Root>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="toggle">
      <Switch.Root className="switch" checked={checked} onCheckedChange={onChange}><Switch.Thumb className="thumb" /></Switch.Root>
      <span>{label}</span>
    </label>
  );
}
