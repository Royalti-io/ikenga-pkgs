/**
 * fixture.ts — synthetic test dataset for the local-store-etl sidecar.
 *
 * Covers the seven Atelier/PA domain tables introduced in migrations
 * 0025–0031. Rows are deterministic (fixed UUIDs / timestamps) so that
 * re-runs are byte-identical and round-trip NDJSON export (WP-06) produces
 * a stable git diff.
 *
 * Wave 4 will add a `live()` function here that extracts from Supabase using
 * the SUPABASE_SERVICE_ROLE_KEY vault key. For now only `fixture()` is
 * exported.
 */

import type { FixtureDataset } from './types.js';

const NOW = '2025-01-01T00:00:00.000Z';
const USER_ID = 'usr_fixture_001';
const PROJECT_ID = 'prj_fixture_001';

export function fixture(): FixtureDataset {
  return {
    // ── 0025 tasks domain ─────────────────────────────────────────────────
    tasks: [
      {
        id: 'tsk_fixture_001',
        title: 'Fixture task alpha',
        description: 'Synthetic test task for local-store round-trip test.',
        status: 'pending',
        priority: 'medium',
        assigned_to: USER_ID,
        assignee_type: 'human',
        created_at: NOW,
        updated_at: NOW,
      },
      {
        id: 'tsk_fixture_002',
        title: 'Fixture task beta',
        description: null,
        status: 'done',
        priority: 'high',
        assigned_to: USER_ID,
        assignee_type: 'human',
        created_at: NOW,
        updated_at: NOW,
      },
    ],

    delegations: [
      {
        id: 'dlg_fixture_001',
        task_id: 'tsk_fixture_001',
        delegated_to: 'agent_fixture_001',
        delegated_by: USER_ID,
        status: 'active',
        created_at: NOW,
        updated_at: NOW,
      },
    ],

    agent_runs: [
      {
        id: 'run_fixture_001',
        agent_id: 'agent_fixture_001',
        task_id: 'tsk_fixture_001',
        status: 'completed',
        started_at: NOW,
        finished_at: NOW,
        output: null,
        error: null,
        created_at: NOW,
      },
    ],

    notifications: [
      {
        id: 'ntf_fixture_001',
        user_id: USER_ID,
        title: 'Test notification',
        body: 'This is a fixture notification.',
        read: 0,
        created_at: NOW,
      },
    ],

    calendar_events: [
      {
        id: 'cal_fixture_001',
        title: 'Fixture event',
        description: null,
        start_at: NOW,
        end_at: NOW,
        owner_id: USER_ID,
        created_at: NOW,
        updated_at: NOW,
      },
    ],

    agent_handoffs: [
      {
        id: 'hnd_fixture_001',
        from_agent: 'agent_fixture_001',
        to_agent: 'agent_fixture_002',
        task_id: 'tsk_fixture_001',
        context: null,
        created_at: NOW,
      },
    ],

    agent_reports: [
      {
        id: 'rpt_fixture_001',
        agent_id: 'agent_fixture_001',
        run_id: 'run_fixture_001',
        summary: 'Fixture report.',
        detail: null,
        created_at: NOW,
      },
    ],

    // ── 0026 mail domain ──────────────────────────────────────────────────
    mail_threads: [
      {
        id: 'mth_fixture_001',
        subject: 'Fixture subject',
        participant_ids: JSON.stringify([USER_ID]),
        created_at: NOW,
        updated_at: NOW,
      },
    ],

    mail_messages: [
      {
        id: 'msg_fixture_001',
        thread_id: 'mth_fixture_001',
        sender_id: USER_ID,
        body: 'Fixture email body.',
        sent_at: NOW,
        created_at: NOW,
      },
    ],

    // ── 0027 outbound domain ──────────────────────────────────────────────
    outbound_sequences: [
      {
        id: 'seq_fixture_001',
        name: 'Fixture sequence',
        status: 'active',
        owner_id: USER_ID,
        created_at: NOW,
        updated_at: NOW,
      },
    ],

    outbound_steps: [
      {
        id: 'stp_fixture_001',
        sequence_id: 'seq_fixture_001',
        step_number: 1,
        action_type: 'email',
        delay_days: 0,
        template: null,
        created_at: NOW,
      },
    ],

    // ── 0028 sales / GTM domain ───────────────────────────────────────────
    leads: [
      {
        id: 'led_fixture_001',
        name: 'Fixture Lead',
        email: 'fixture@example.com',
        status: 'new',
        owner_id: USER_ID,
        created_at: NOW,
        updated_at: NOW,
      },
    ],

    opportunities: [
      {
        id: 'opp_fixture_001',
        lead_id: 'led_fixture_001',
        title: 'Fixture opportunity',
        stage: 'prospecting',
        value: 0,
        owner_id: USER_ID,
        created_at: NOW,
        updated_at: NOW,
      },
    ],

    // ── 0029 finance domain ───────────────────────────────────────────────
    invoices: [
      {
        id: 'inv_fixture_001',
        number: 'INV-0001-FIXTURE',
        amount: 0,
        currency: 'USD',
        status: 'draft',
        owner_id: USER_ID,
        created_at: NOW,
        updated_at: NOW,
      },
    ],

    // ── 0030 content / product domain ─────────────────────────────────────
    content_items: [
      {
        id: 'cnt_fixture_001',
        title: 'Fixture content',
        body: null,
        status: 'draft',
        owner_id: USER_ID,
        created_at: NOW,
        updated_at: NOW,
      },
    ],

    // ── 0031 work domain ──────────────────────────────────────────────────
    projects: [
      {
        id: PROJECT_ID,
        name: 'Fixture project',
        description: null,
        status: 'active',
        owner_id: USER_ID,
        created_at: NOW,
        updated_at: NOW,
      },
    ],
  };
}
