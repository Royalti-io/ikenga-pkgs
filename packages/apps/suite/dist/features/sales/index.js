import { html } from '../../lib/ui.js';

function SalesPlaceholder() {
  return html`
    <div style=${{ padding: '2rem', color: 'var(--suite-muted)' }}>
      <h2 style=${{ marginTop: 0 }}>Sales</h2>
      <p>Pipeline / deals view. Populate from <code>deals</code> Supabase table.</p>
      <p>Replace this component with your pipeline UI.</p>
    </div>
  `;
}

export default {
  id: 'sales',
  label: 'Sales',
  icon: 'trending-up',
  route: 'sales',
  Component: SalesPlaceholder,
};
