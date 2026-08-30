"use client";

import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

export type EnquiryType = "franchise" | "fleet";

type SubmissionState =
  | { kind: "idle"; message: "" }
  | { kind: "submitting"; message: string }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

export type EnquiryFormProps = {
  type: EnquiryType;
  children: ReactNode;
  className?: string;
  submitLabel?: string;
  submittingLabel?: string;
  successMessage?: string;
  submitClassName?: string;
};

function serializeForm(form: HTMLFormElement): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const data = new FormData(form);

  for (const [name, rawValue] of data.entries()) {
    if (name === "website" || rawValue instanceof File) continue;

    const existing = payload[name];
    if (existing === undefined) {
      payload[name] = rawValue;
    } else if (Array.isArray(existing)) {
      existing.push(rawValue);
    } else {
      payload[name] = [existing, rawValue];
    }
  }

  const controls = Array.from(form.elements);
  const checkboxNames = new Set(
    controls
      .filter(
        (control): control is HTMLInputElement =>
          control instanceof HTMLInputElement &&
          control.type === "checkbox" &&
          Boolean(control.name),
      )
      .map((control) => control.name),
  );

  for (const name of checkboxNames) {
    const checkboxes = controls.filter(
      (control): control is HTMLInputElement =>
        control instanceof HTMLInputElement &&
        control.type === "checkbox" &&
        control.name === name,
    );
    const checked = checkboxes.filter((control) => control.checked);
    payload[name] =
      checkboxes.length === 1
        ? checked.length === 1
        : checked.map((control) => control.value);
  }

  for (const control of controls) {
    if (
      control instanceof HTMLSelectElement &&
      control.multiple &&
      control.name
    ) {
      payload[control.name] = Array.from(control.selectedOptions, (option) =>
        option.value,
      );
    }
  }

  return payload;
}

export function EnquiryForm({
  type,
  children,
  className,
  submitLabel = "Send enquiry",
  submittingLabel = "Sending enquiry…",
  successMessage = "Thanks. Your enquiry has been sent to our team.",
  submitClassName = "button button--red",
}: EnquiryFormProps) {
  const [state, setState] = useState<SubmissionState>({
    kind: "idle",
    message: "",
  });
  const startedAt = useRef<number | null>(null);
  const submitting = useRef(false);
  const statusId = useId();

  useEffect(() => {
    startedAt.current = Date.now();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;

    form.querySelectorAll<HTMLElement>('[data-server-invalid="true"]').forEach((control) => {
      control.removeAttribute("aria-invalid");
      control.removeAttribute("aria-describedby");
      delete control.dataset.serverInvalid;
    });

    const vehicleTypes = Array.from(
      form.querySelectorAll<HTMLInputElement>('input[name="vehicleTypes"]'),
    );
    vehicleTypes.forEach((control) => control.setCustomValidity(""));
    if (
      type === "fleet" &&
      vehicleTypes.length > 0 &&
      !vehicleTypes.some((control) => control.checked)
    ) {
      vehicleTypes[0].setCustomValidity("Select at least one vehicle type.");
    }

    if (!form.reportValidity() || submitting.current) return;

    submitting.current = true;
    setState({ kind: "submitting", message: submittingLabel });

    try {
      const payload = {
        ...serializeForm(form),
        type,
        website: new FormData(form).get("website") ?? "",
        startedAt: startedAt.current ?? 0,
      };
      const response = await fetch("/api/enquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result: unknown = await response.json().catch(() => null);
      const message =
        result &&
        typeof result === "object" &&
        "message" in result &&
        typeof result.message === "string"
          ? result.message
          : "We could not send your enquiry. Please try again or call us.";
      const field =
        result &&
        typeof result === "object" &&
        "field" in result &&
        typeof result.field === "string" &&
        /^[A-Za-z][A-Za-z0-9]*$/u.test(result.field)
          ? result.field
          : null;

      if (!response.ok) {
        setState({ kind: "error", message });
        if (field) {
          const invalidControl = form.querySelector<HTMLElement>(`[name="${field}"]`);
          if (invalidControl) {
            invalidControl.setAttribute("aria-invalid", "true");
            invalidControl.setAttribute("aria-describedby", statusId);
            invalidControl.dataset.serverInvalid = "true";
            const clearError = () => {
              invalidControl.removeAttribute("aria-invalid");
              invalidControl.removeAttribute("aria-describedby");
              delete invalidControl.dataset.serverInvalid;
            };
            invalidControl.addEventListener("input", clearError, { once: true });
            invalidControl.addEventListener("change", clearError, { once: true });
            window.requestAnimationFrame(() => invalidControl.focus());
          }
        }
        return;
      }

      form.reset();
      startedAt.current = Date.now();
      setState({ kind: "success", message: successMessage });
    } catch {
      setState({
        kind: "error",
        message:
          "We could not connect to the enquiry service. Please try again or call us.",
      });
    } finally {
      submitting.current = false;
    }
  }

  const isSubmitting = state.kind === "submitting";

  return (
    <form
      className={className}
      onSubmit={handleSubmit}
      aria-describedby={state.message ? statusId : undefined}
      noValidate={false}
    >
      <div
        className="honeypot-field"
        aria-hidden="true"
        style={{ position: "absolute", left: "-10000px", width: 1, height: 1 }}
      >
        <label htmlFor={`${statusId}-website`}>Leave this field empty</label>
        <input
          id={`${statusId}-website`}
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      {children}

      <button
        className={submitClassName}
        type="submit"
        disabled={isSubmitting}
        aria-disabled={isSubmitting}
      >
        {isSubmitting ? submittingLabel : submitLabel}
      </button>

      {state.message && (
        <p
          id={statusId}
          className={
            state.kind === "error"
              ? "form-error"
              : state.kind === "success"
                ? "form-success"
                : "form-status"
          }
          role={state.kind === "error" ? "alert" : "status"}
          aria-live={state.kind === "error" ? "assertive" : "polite"}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
