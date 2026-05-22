import { useState } from 'react';
import { submitForm } from '../lib/api';

interface Props {
  wixInstanceId: string;
}

const initial = {
  email: '',
  first_name: '',
  last_name: '',
  phone: '',
  company: '',
  utm_source: '',
  utm_medium: '',
  utm_campaign: '',
  utm_term: '',
  utm_content: '',
  page_url: '',
  referrer: '',
};

type FormState = typeof initial;

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  help?: string;
}

function Field({ label, value, onChange, type = 'text', placeholder, help }: FieldProps) {
  return (
    <div className="field">
      <label className="field-label">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {help && <div className="field-help">{help}</div>}
    </div>
  );
}

export function FormTester({ wixInstanceId }: Props) {
  const [form, setForm] = useState<FormState>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ contact_id: string; created: boolean } | null>(null);

  function update<K extends keyof FormState>(field: K, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const r = await submitForm({
        wix_instance_id: wixInstanceId,
        email: form.email,
        first_name: form.first_name || undefined,
        last_name: form.last_name || undefined,
        phone: form.phone || undefined,
        company: form.company || undefined,
        utm: {
          utm_source: form.utm_source || undefined,
          utm_medium: form.utm_medium || undefined,
          utm_campaign: form.utm_campaign || undefined,
          utm_term: form.utm_term || undefined,
          utm_content: form.utm_content || undefined,
        },
        page_url: form.page_url || undefined,
        referrer: form.referrer || undefined,
        submitted_at: new Date().toISOString(),
      });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit the lead');
    } finally {
      setSubmitting(false);
    }
  }

  function prefillDemo() {
    setForm({
      email: `lead.${Date.now()}@example.com`,
      first_name: 'Ada',
      last_name: 'Lovelace',
      phone: '+1-555-0142',
      company: 'Analytical Engines Ltd',
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'spring-launch',
      utm_term: 'wix hubspot integration',
      utm_content: 'banner-v2',
      page_url: 'https://example.com/landing',
      referrer: 'https://google.com',
    });
  }

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
        <h2 style={{ margin: 0 }}>Capture a lead</h2>
        <button className="button secondary" onClick={prefillDemo}>Try with example data</button>
      </div>
      <p style={{ marginTop: 0, color: '#52606d', fontSize: 13 }}>
        Send a lead through the same path your Wix forms use. The contact appears in HubSpot within a few seconds.
      </p>

      <h3 className="section-title">Contact details</h3>
      <div className="grid-2">
        <Field label="Email" type="email" value={form.email} onChange={(v) => update('email', v)} placeholder="lead@example.com" />
        <Field label="Phone" value={form.phone} onChange={(v) => update('phone', v)} placeholder="+1 555 0142" />
        <Field label="First name" value={form.first_name} onChange={(v) => update('first_name', v)} />
        <Field label="Last name" value={form.last_name} onChange={(v) => update('last_name', v)} />
        <Field label="Company" value={form.company} onChange={(v) => update('company', v)} />
      </div>

      <h3 className="section-title">Page context</h3>
      <p className="section-subtitle">Where the lead came from on your site. Filled in automatically when a real visitor submits a Wix form.</p>
      <div className="grid-2">
        <Field label="Page URL" value={form.page_url} onChange={(v) => update('page_url', v)} placeholder="https://yoursite.com/landing" />
        <Field label="Referrer" value={form.referrer} onChange={(v) => update('referrer', v)} placeholder="https://google.com" />
      </div>

      <h3 className="section-title">Marketing attribution</h3>
      <p className="section-subtitle">
        Optional. Tells you where the lead came from, useful for measuring campaigns, ads, and emails. Normally
        picked up automatically from the link the visitor clicked.
      </p>
      <div className="grid-3">
        <Field label="Source" value={form.utm_source} onChange={(v) => update('utm_source', v)} placeholder="google, facebook, newsletter" />
        <Field label="Channel" value={form.utm_medium} onChange={(v) => update('utm_medium', v)} placeholder="cpc, email, social" />
        <Field label="Campaign" value={form.utm_campaign} onChange={(v) => update('utm_campaign', v)} placeholder="spring-launch" />
        <Field label="Search term" value={form.utm_term} onChange={(v) => update('utm_term', v)} placeholder="wix hubspot integration" />
        <Field label="Variant" value={form.utm_content} onChange={(v) => update('utm_content', v)} placeholder="banner-v2" />
      </div>

      <div className="row" style={{ marginTop: 24 }}>
        <button className="button" onClick={submit} disabled={submitting || !form.email}>
          {submitting ? 'Submitting…' : 'Submit lead'}
        </button>
        {!form.email && <span style={{ color: '#7b8794', fontSize: 13 }}>Email is required.</span>}
      </div>

      {error && <div className="error">{error}</div>}
      {result && (
        <div className="success">
          {result.created ? 'Created' : 'Updated'} HubSpot contact <code>{result.contact_id}</code>.
        </div>
      )}
    </div>
  );
}
