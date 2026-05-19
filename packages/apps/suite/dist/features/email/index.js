import { html } from '../../lib/ui.js';

function EmailPlaceholder() {
  return html`
    <div style=${{ padding: '2rem', color: 'var(--suite-muted)' }}>
      <h2 style=${{ marginTop: 0 }}>Email</h2>
      <p>Email drafts and inbox. Populate from <code>email_drafts</code> Supabase table.</p>
      <p>Replace this component with your email UI.</p>
    </div>
  `;
}

export default {
  id: 'email',
  label: 'Email',
  icon: 'mail',
  route: 'email',
  Component: EmailPlaceholder,
};
