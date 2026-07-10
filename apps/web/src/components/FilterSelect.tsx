import { choiceLabel } from '@msx/shared';

interface FilterSelectProps {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  allLabel?: string;
}

/** A labeled dropdown for filtering by a controlled choice list. */
export default function FilterSelect({ label, value, options, onChange, allLabel = 'All' }: FilterSelectProps) {
  return (
    <div className="field">
      <label>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{allLabel}</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {choiceLabel(opt)}
          </option>
        ))}
      </select>
    </div>
  );
}
