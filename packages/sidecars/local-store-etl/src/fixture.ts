/**
 * fixture.ts — synthetic test dataset for the local-store-etl sidecar.
 *
 * Covers all 36 domain tables from migrations 0025–0031 with one
 * representative row each. Every column name matches the STRICT SQLite schema.
 * Used by the `run` (fixture) RPC command to verify the ETL pipeline.
 *
 * Wave 4 will add a `live()` function that extracts from Supabase using the
 * SUPABASE_SERVICE_ROLE_KEY vault key. For now only `fixture()` is exported.
 */

import type { FixtureDataset } from './types.js';

const NOW = '2025-01-15T10:00:00.000Z';
const DATE = '2025-01-15';
const USER = 'usr_fixture_001';
const AGENT = 'agent_fixture_001';

export function fixture(): FixtureDataset {
  return {
    // ── 0025 tasks domain ─────────────────────────────────────────────────
    tasks: [
      {
        id: 'tsk_fixture_001',
        title: 'Fixture task alpha',
        description: 'Synthetic test task for the ETL round-trip.',
        status: 'pending',
        priority: 'medium',
        assigned_to: USER,
        assignee_type: 'human',
        created_at: NOW,
        updated_at: NOW,
      },
    ],

    delegations: [
      {
        id: 'dlg_fixture_001',
        task_id: 'tsk_fixture_001',
        delegated_to: AGENT,
        delegate_type: 'agent',
        status: 'assigned',
        assigned_at: NOW,
        updated_at: NOW,
      },
    ],

    agent_runs: [
      {
        id: 'run_fixture_001',
        agent_name: AGENT,
        command: 'run_fixture_etl',
        status: 'completed',
        output_summary: 'All fixture rows written.',
        started_at: NOW,
        completed_at: NOW,
        created_at: NOW,
      },
    ],

    notifications: [
      {
        id: 'ntf_fixture_001',
        channel: 'slack',
        message: 'Fixture notification.',
        task_id: 'tsk_fixture_001',
        sent_at: NOW,
        status: 'sent',
      },
    ],

    calendar_events: [
      {
        id: 'cal_fixture_001',
        google_event_id: 'google_evt_fixture_001',
        title: 'Fixture calendar event',
        description: null,
        start_time: '2025-01-15T09:00:00.000Z',
        end_time: '2025-01-15T10:00:00.000Z',
        source: 'google',
        reminder_sent: 0,
        created_at: NOW,
        updated_at: NOW,
      },
    ],

    agent_handoffs: [
      {
        id: 'hof_fixture_001',
        timestamp: NOW,
        from_agent: AGENT,
        to_agent: 'agent_fixture_002',
        request_type: 'review',
        domain: 'tasks',
        request_summary: 'Review fixture task alpha.',
        urgency: 'normal',
        status: 'pending',
        created_at: NOW,
        updated_at: NOW,
      },
    ],

    agent_reports: [
      {
        id: 'rpt_fixture_001',
        job_id: 'run_fixture_001',
        title: 'Fixture ETL Report',
        report_type: 'etl_run',
        domain: 'all',
        authored_by: AGENT,
        summary: 'All 36 domain tables seeded with fixture data.',
        status: 'final',
        created_at: NOW,
        updated_at: NOW,
      },
    ],

    // ── 0026 mail domain ──────────────────────────────────────────────────
    email_messages: [
      {
        id: 'msg_fixture_001',
        inbox_source: 'gmail',
        message_id: 'msg_id_fixture_001@gmail.com',
        subject: 'Fixture inbound message',
        from_address: 'sender@example.com',
        to_address: USER,
        body_text: 'Hello from the fixture.',
        received_at: NOW,
        created_at: NOW,
        updated_at: NOW,
      },
    ],

    email_sequences: [
      {
        id: 'seq_fixture_001',
        name: 'Fixture outreach sequence',
        slug: 'fixture-outreach-001',
        total_steps: 3,
        status: 'draft',
        created_by: USER,
        created_at: NOW,
        updated_at: NOW,
      },
    ],

    email_drafts: [
      {
        id: 'drf_fixture_001',
        sequence_id: 'seq_fixture_001',
        sequence_step: 1,
        subject: 'Fixture draft step 1',
        body: '<p>Fixture email body</p>',
        body_format: 'html',
        type: 'sequence_step',
        status: 'draft',
        created_by: USER,
        created_at: NOW,
        updated_at: NOW,
      },
    ],

    email_replies: [
      {
        id: 'rpl_fixture_001',
        classification: 'positive_interest',
        subject: 'Re: Fixture outreach',
        body: '<p>Thank you for reaching out.</p>',
        body_format: 'html',
        from_name: 'Fixture Sender',
        from_email: 'sender@example.com',
        delivery_system: 'gmail',
        recipients: '["user@royalti.io"]',
        status: 'pending_review',
        created_by: USER,
        metadata: '{}',
        created_at: NOW,
        updated_at: NOW,
      },
    ],

    // ── 0027 outbound domain ──────────────────────────────────────────────
    social_queue: [
      {
        id: 'soc_fixture_001',
        platform: 'twitter',
        account: '@royalti',
        content: 'Fixture tweet content for testing #etl',
        status: 'draft',
        source: 'manual',
        created_at: NOW,
      },
    ],

    newsletter_sends: [
      {
        id: 'nws_fixture_001',
        draft_slug: 'fixture-newsletter-001',
        subject: 'Fixture newsletter',
        delivery_system: 'mailchimp',
        created_at: NOW,
      },
    ],

    // ── 0028 sales / GTM domain ───────────────────────────────────────────
    sales_deals: [
      {
        id: 'sdl_fixture_001',
        company: 'Fixture Corp',
        stage: 'discovery',
        source: 'outbound',
        created_at: NOW,
        updated_at: NOW,
      },
    ],

    sales_stage_transitions: [
      {
        id: 'sst_fixture_001',
        notion_deal_id: 'sdl_fixture_001',
        company_name: 'Fixture Corp',
        to_stage: 'proposal',
        transition_date: DATE,
        created_at: NOW,
      },
    ],

    sales_lead_scores: [
      {
        id: 'sls_fixture_001',
        notion_deal_id: 'sdl_fixture_001',
        company_name: 'Fixture Corp',
        score_date: DATE,
        total_score: 72,
        priority: 'high',
        company_fit_score: 80,
        need_indicators_score: 65,
        engagement_score: 70,
        created_at: NOW,
      },
    ],

    sales_forecasts: [
      {
        id: 'sfr_fixture_001',
        forecast_date: DATE,
        quarter: 'Q1-2025',
        likely_forecast: '250000',
        created_at: NOW,
      },
    ],

    partnership_deals: [
      {
        id: 'pdl_fixture_001',
        name: 'Fixture Partnership',
        category: 'technology',
        stage: 'discovery',
        priority: 'medium',
        created_at: NOW,
        updated_at: NOW,
      },
    ],

    fundraising_deals: [
      {
        id: 'frd_fixture_001',
        investor_name: 'Fixture Capital',
        investor_type: 'vc',
        stage: 'prospecting',
        priority: 'medium',
        created_at: NOW,
        updated_at: NOW,
      },
    ],

    fundraising_activities: [
      {
        id: 'fra_fixture_001',
        deal_id: 'frd_fixture_001',
        activity_type: 'email',
        summary: 'Initial outreach to Fixture Capital.',
        occurred_at: NOW,
        created_at: NOW,
      },
    ],

    fundraising_outreach: [
      {
        id: 'fro_fixture_001',
        deal_id: 'frd_fixture_001',
        channel: 'email',
        body: 'Hello, we are building Royalti...',
        status: 'draft',
        sequence_number: 1,
        drafted_by: AGENT,
        created_at: NOW,
        updated_at: NOW,
      },
    ],

    // ── 0029 finance domain ───────────────────────────────────────────────
    bank_accounts: [
      {
        id: 'bka_fixture_001',
        account_name: 'Fixture USD Account',
        entity: 'royalti_inc',
        currency: 'USD',
        bank: 'Fixture Bank',
        sheet_name: 'Operating',
        is_active: 1,
        created_at: NOW,
      },
    ],

    transaction_ledger: [
      {
        id: 'txn_fixture_001',
        txn_date: DATE,
        account_id: 'bka_fixture_001',
        entity: 'royalti_inc',
        type: 'revenue',
        description: 'Fixture revenue entry',
        amount: '1000.00',
        currency: 'USD',
        created_at: NOW,
      },
    ],

    classification_rules: [
      {
        id: 'clr_fixture_001',
        name: 'Fixture stripe revenue',
        category: 'revenue',
        pattern: 'STRIPE',
        priority: 100,
        created_at: NOW,
      },
    ],

    exchange_rates: [
      {
        id: 'exr_fixture_001',
        rate_month: '2025-01',
        ngn_usd: '0.00063',
        eur_usd: '1.09',
        gbp_usd: '1.27',
        created_at: NOW,
      },
    ],

    inter_company_entries: [
      {
        id: 'ice_fixture_001',
        ledger_account: 'interco_payable',
        entry_date: DATE,
        source_entity: 'royalti_inc',
        destination_entity: 'dixtrit',
        amount: '500.00',
        currency: 'USD',
        transfer_type: 'revenue_share',
        created_at: NOW,
      },
    ],

    paystack_splits: [
      {
        id: 'pss_fixture_001',
        original_txn_id: 'txn_fixture_001',
        split_date: DATE,
        total_ngn: '1590000',
        total_usd: '1000.00',
        royalti_fee_ngn: '238500',
        royalti_fee_usd: '150.00',
        dixtrit_portion_ngn: '1351500',
        dixtrit_portion_usd: '850.00',
        created_at: NOW,
      },
    ],

    receivables: [
      {
        id: 'rcv_fixture_001',
        document_no: 'INV-2025-001',
        invoice_date: DATE,
        due_date: '2025-02-15',
        customer: 'Fixture Client',
        total_amount: '5000.00',
        balance_left: '5000.00',
        currency: 'USD',
        invoice_status: 'outstanding',
        created_at: NOW,
      },
    ],

    cfo_processing_runs: [
      {
        id: 'cpr_fixture_001',
        run_type: 'monthly_close',
        status: 'completed',
        output_summary: 'Monthly close for 2025-01 completed.',
        created_at: NOW,
      },
    ],

    // ── 0030 content / product domain ─────────────────────────────────────
    strategic_initiatives: [
      {
        id: 'ini_fixture_001',
        quarter: 'Q1-2025',
        name: 'Fixture initiative alpha',
        status: 'active',
        owner_agent: AGENT,
        created_at: NOW,
        updated_at: NOW,
      },
    ],

    risk_register: [
      {
        id: 'rsk_fixture_001',
        category: 'technical',
        title: 'Fixture risk: schema drift',
        severity: 'medium',
        probability: 'low',
        owner: AGENT,
        status: 'Active',
        created_at: NOW,
        updated_at: NOW,
      },
    ],

    product_features: [
      {
        id: 'pft_fixture_001',
        name: 'Fixture feature: local-store',
        status: 'in_progress',
        created_at: NOW,
        updated_at: NOW,
      },
    ],

    content_calendar: [
      {
        id: 'ccl_fixture_001',
        type: 'blog_post',
        channel: 'website',
        title: 'Fixture blog post',
        status: 'planned',
        assigned_to: USER,
        publish_date: '2025-02-01',
        created_at: NOW,
        updated_at: NOW,
      },
    ],

    tech_debt_items: [
      {
        id: 'tdi_fixture_001',
        title: 'Fixture tech debt: supabase-js in renderer',
        area: 'frontend',
        status: 'identified',
        impact_score: 7,
        effort_score: 5,
        created_at: NOW,
        updated_at: NOW,
      },
    ],

    metrics_snapshots: [
      {
        id: 'mss_fixture_001',
        snapshot_date: DATE,
        period_type: 'monthly',
        period_label: '2025-01',
        domain: 'all',
        metrics: '{"mrr_usd":50000}',
        created_at: NOW,
        updated_at: NOW,
      },
    ],

    // ── 0031 work domain ──────────────────────────────────────────────────
    cron_job_runs: [
      {
        id: 'crn_fixture_001',
        job_id: 'etl_daily_sync',
        agent: AGENT,
        status: 'success',
        summary: 'All 36 tables synced.',
        duration_ms: 1234,
        num_turns: 3,
        created_at: NOW,
      },
    ],
  };
}
