import { html } from '../../lib/ui.js';

function OutboundPlaceholder() {
  return html`
    <div style=${{ padding: '2rem', color: 'var(--suite-muted)' }}>
      <h2 style=${{ marginTop: 0 }}>Outbound</h2>
      <p>Outbound messaging queue. Populate from <code>outbound_messages</code> Supabase table.</p>
      <p>Replace this component with your outbound UI.</p>
    </div>
  `;
}

export default {
  id: 'outbound',
  label: 'Outbound',
  icon: 'send',
  route: 'outbound',
  Component: OutboundPlaceholder,
};
