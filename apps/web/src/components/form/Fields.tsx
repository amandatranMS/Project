import { choiceLabel } from '@msx/shared';

interface BaseProps {
  label: string;
  required?: boolean;
  full?: boolean;
}

export function TextField({ label, value, onChange, required, full, placeholder }: BaseProps & {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className={`form-field${full ? ' full' : ''}`}>
      <label>
        {label} {required && <span className="req">*</span>}
      </label>
      <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function NumberField({ label, value, onChange, full }: BaseProps & {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className={`form-field${full ? ' full' : ''}`}>
      <label>{label}</label>
      <input type="number" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function DateField({ label, value, onChange, full }: BaseProps & {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className={`form-field${full ? ' full' : ''}`}>
      <label>{label}</label>
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function TextAreaField({ label, value, onChange, full }: BaseProps & {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className={`form-field${full ? ' full' : ''}`}>
      <label>{label}</label>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export function SelectField({ label, value, onChange, options, required, full, placeholder }: BaseProps & {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  placeholder?: string;
}) {
  return (
    <div className={`form-field${full ? ' full' : ''}`}>
      <label>
        {label} {required && <span className="req">*</span>}
      </label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{placeholder ?? 'Select…'}</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {choiceLabel(opt)}
          </option>
        ))}
      </select>
    </div>
  );
}
