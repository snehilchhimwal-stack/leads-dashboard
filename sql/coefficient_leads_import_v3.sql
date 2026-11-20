/*
 * ==============================================================================
 * LEAD PERFORMANCE & HISTORY REPORT  —  v3 (2026-11-20, call status added)
 * ==============================================================================
 * NOTE: no Coefficient parameter tokens (double-curly-brace syntax) anywhere in
 * this text, comments included.
 *
 * Same 29 output columns, same names, same order as v1, so the sheet and the
 * Apps Script / dashboard readers need no change.
 *
 * WHAT CHANGED FROM v2 (v3, 2026-11-20)
 *  Each status entry now carries the call status the RM picked in the CRM, in
 *  square brackets before the comment:
 *      "Name: [Busy] Talking to someone else - 2026-11-18 11:16"
 *      "Name: [Ringing] - 2026-11-19 10:43"          (call logged with no comment)
 *  24% of status entries (30 days to 20 Nov) have a call status but no comment;
 *  without the status those calls were invisible to the follow-up logic, and a
 *  note like "Talking to someone else" (status Busy) read as a conversation.
 *  Statuses: Ringing, Busy, Call Declined, Not Reachable, Followup Missed,
 *  Invalid No (not reached / stop) and Call Connected, Connected On Whatsapp
 *  (a real conversation). Entries with no status keep the v2 shape.
 *  last_comment / last_connect / last_connect_time are unchanged.
 *  Readers that understand the bracket: FollowupEngine.gs (emails) and
 *  js/core-outcome-engine.js (dashboard), both able to read v2 too.
 *  Newest 50 entries per lead (was 60) so the longer entries still fit the
 *  server's 5120-char group_concat_max_len.
 *
 * WHAT CHANGED FROM v1 (all checked on Metabase, 20 Nov 2026)
 *  1. internal_status_comments is built the SAME way for claimed and directly
 *     assigned leads: "Name: comment - YYYY-MM-DD HH:MM", oldest first.
 *     v1's direct branch used ish.action_date, which is NULL on 98.6% of status
 *     rows, and had no name — so every directly assigned lead reached the sheet
 *     as "comment -  | comment - ", newest first, unparseable by the SLA engine.
 *  2. last_comment / last_connect / last_connect_time come from the NEWEST
 *     status row. v1 selected them un-aggregated inside a GROUP BY, so MySQL
 *     returned an arbitrary (in practice the oldest) row — they froze at the
 *     first call.
 *  3. Directly assigned leads: only the CURRENT assignment (al.id = l.assign_id).
 *     v1 joined every assign_leads row, so 1,059 of 4,297 rows (25%) were
 *     copies for RMs the lead had already been moved away from.
 *  4. Directly assigned leads are windowed on the ASSIGNMENT date, like claims.
 *     v1 windowed on lead creation, so 1,487 older leads reassigned to the team
 *     this week were missing.
 *  5. Status history, stage history and call stats are aggregated per lead in
 *     their own CTEs (no row fan-out across ish x os x claims).
 *  6. Calls are counted per LEAD (device_call_logs.lead_id), over the lead's
 *     whole life; v1 counted device calls per client, only on the client's
 *     newest lead, and only inside the 7-day window.
 *  7. Comment text has line breaks and "|" removed so one comment can never
 *     split into two entries; stage dates are HH:MM (v1 had :SS, which the
 *     parser rejects).
 *  8. The region-parent exclusion keeps leads with no project region
 *     (v1's NOT IN silently dropped NULLs).
 * ==============================================================================
 */

WITH RECURSIVE TeamCTE AS (
    SELECT child_id, parent_id, 1 AS level
    FROM team_mappings
    WHERE parent_id = 5022 AND deleted_at IS NULL
    UNION ALL
    SELECT t.child_id, t.parent_id, r.level + 1
    FROM team_mappings t
    JOIN TeamCTE r ON t.parent_id = r.child_id
    WHERE r.level < 15 AND t.deleted_at IS NULL
),
FilterTeam AS (
    SELECT child_id FROM TeamCTE
    UNION
    SELECT 35083
),

-- Claims by the team made in the last 7 days (incl. today)
claimed AS (
    SELECT lc.id AS claim_id, lc.lead_id, lc.user_id AS userid,
           lc.created_at AS lead_assigned_at, lc.deleted_at AS lead_closed_at,
           lc.closing_reason AS lead_closing_reason, lc.comment AS lead_closing_comment,
           lc.updated_at AS closing_updated_at
    FROM lead_claims lc
    JOIN leads l ON l.id = lc.lead_id AND l.deleted_at IS NULL
    WHERE lc.user_id IN (SELECT child_id FROM FilterTeam)
      AND lc.created_at >= CURDATE() - INTERVAL 6 DAY
      AND lc.created_at <  CURDATE() + INTERVAL 1 DAY
),

-- Current assignment to the team made in the last 7 days, not already a claim above
assigned AS (
    SELECT al.lead_id, al.assign_to AS userid, al.created_at AS lead_assigned_at
    FROM assign_leads al
    JOIN leads l ON l.id = al.lead_id AND l.assign_id = al.id AND l.deleted_at IS NULL
    WHERE al.assign_to IN (SELECT child_id FROM FilterTeam)
      AND al.deleted_at IS NULL
      AND al.created_at >= CURDATE() - INTERVAL 6 DAY
      AND al.created_at <  CURDATE() + INTERVAL 1 DAY
      AND NOT EXISTS (SELECT 1 FROM claimed c WHERE c.lead_id = al.lead_id)
),

scope AS (
    SELECT lead_id FROM claimed
    UNION
    SELECT lead_id FROM assigned
),

-- Status history: one row per lead, full log + newest entry
ish_ranked AS (
    SELECT h.lead_id, h.id, h.created_at, h.calling_status, cst.name AS call_status_name,
           TRIM(REPLACE(REPLACE(REPLACE(COALESCE(h.comment, ''), '\r', ' '), '\n', ' '), '|', '/')) AS comment_clean,
           COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''), 'Unknown') AS by_name,
           ROW_NUMBER() OVER (PARTITION BY h.lead_id ORDER BY h.created_at DESC, h.id DESC) AS rn
    FROM internal_status_history h
    JOIN scope s ON s.lead_id = h.lead_id
    LEFT JOIN users u ON u.id = COALESCE(h.created_by, h.user_id)
    LEFT JOIN calling_status cst ON cst.id = h.calling_status
    WHERE h.deleted_at IS NULL
),
ish_agg AS (
    SELECT lead_id,
           GROUP_CONCAT(CONCAT(by_name, ': ',
                               CASE WHEN call_status_name IS NULL THEN comment_clean
                                    WHEN comment_clean = '' THEN CONCAT('[', call_status_name, ']')
                                    ELSE CONCAT('[', call_status_name, '] ', comment_clean) END,
                               ' - ', DATE_FORMAT(created_at, '%Y-%m-%d %H:%i'))
                        ORDER BY created_at, id SEPARATOR ' | ') AS internal_status_comments
    FROM ish_ranked
    WHERE rn <= 50   -- newest 50 entries: the server's group_concat_max_len is 5120 chars, and an
                     -- oldest-first list that overflows would lose the NEWEST entries, not the oldest
    GROUP BY lead_id
),
ish_last AS (
    SELECT r.lead_id, r.created_at AS last_connect_time, r.comment_clean AS last_comment, cs.name AS last_connect
    FROM ish_ranked r
    LEFT JOIN calling_status cs ON cs.id = r.calling_status
    WHERE r.rn = 1
),

-- Stage history: one row per lead
stage_agg AS (
    SELECT os.object_id AS lead_id,
           GROUP_CONCAT(CONCAT(COALESCE(NULLIF(TRIM(CONCAT(COALESCE(ua.first_name, ''), ' ', COALESCE(ua.last_name, ''))), ''), 'Unknown'), ': ',
                               st.name,
                               CASE WHEN TRIM(COALESCE(os.comments, '')) <> ''
                                    THEN CONCAT(' / ', TRIM(REPLACE(REPLACE(REPLACE(os.comments, '\r', ' '), '\n', ' '), '|', '/')))
                                    ELSE '' END,
                               ' - ', DATE_FORMAT(os.created_at, '%Y-%m-%d %H:%i'))
                        ORDER BY os.id SEPARATOR ' | ') AS stage_comments,
           MIN(CASE WHEN os.stage_id = 3 THEN os.created_at END) AS opp_at
    FROM object_stages os
    JOIN scope s ON s.lead_id = os.object_id
    LEFT JOIN users ua ON ua.id = os.user_id
    LEFT JOIN stages st ON st.id = os.stage_id
    WHERE os.deleted_at IS NULL
    GROUP BY os.object_id
),

-- Calls per lead, whole life of the lead
crm_calls AS (
    SELECT cl.object_id AS lead_id,
           COUNT(DISTINCT cl.id) AS attempts,
           COUNT(DISTINCT CASE WHEN cd.conversation_duration > 0 THEN cl.id END) AS connected,
           COALESCE(SUM(cd.conversation_duration), 0) AS talk
    FROM engage.call_logs cl
    JOIN scope s ON s.lead_id = cl.object_id
    LEFT JOIN engage.call_details cd ON cd.call_log_id = cl.id
    WHERE cl.type IN (1, 4) AND cl.deleted_at IS NULL
    GROUP BY cl.object_id
),
device_calls AS (
    SELECT d.lead_id,
           COUNT(*) AS attempts,
           SUM(d.duration > 0) AS connected,
           COALESCE(SUM(d.duration), 0) AS talk
    FROM engage.device_call_logs d
    JOIN scope s ON s.lead_id = d.lead_id
    WHERE d.deleted_at IS NULL AND d.call_type = 'Outgoing'
    GROUP BY d.lead_id
),

-- One row per (lead, RM)
base AS (
    SELECT c.lead_id, c.userid, c.lead_assigned_at, c.lead_closed_at, c.lead_closing_reason,
           c.lead_closing_comment,
           CASE WHEN c.lead_closing_reason IS NOT NULL THEN c.closing_updated_at END AS closing_reason_at
    FROM claimed c
    UNION ALL
    SELECT a.lead_id, a.userid, a.lead_assigned_at,
           CASE WHEN l.closing_reason IS NOT NULL THEN l.updated_at END,
           l.closing_reason, '',
           CASE WHEN l.closing_reason IS NOT NULL THEN l.updated_at END
    FROM assigned a
    JOIN leads l ON l.id = a.lead_id
)

SELECT
    COALESCE(rp.name, rpu.name, 'Unassigned')                                     AS region,
    re.name                                                                        AS rm_region,
    reg.name                                                                       AS project_region,
    b.lead_id,
    TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, '')))       AS RM,
    (SELECT GROUP_CONCAT(DISTINCT TRIM(CONCAT(COALESCE(ut.first_name, ''), ' ', COALESCE(ut.last_name, ''))) SEPARATOR ', ')
       FROM team_mappings tm JOIN users ut ON ut.id = tm.parent_id
      WHERE tm.child_id = b.userid AND tm.deleted_at IS NULL)                      AS TL,
    r.name                                                                         AS rm_role,
    u.is_active                                                                    AS rm_is_active,
    p.name                                                                         AS project,
    cl.name                                                                        AS client,
    l.created_at                                                                   AS lead_created_at,
    b.lead_assigned_at,
    sa.opp_at,
    b.lead_closed_at,
    b.lead_closing_reason,
    b.lead_closing_comment,
    gs.name                                                                        AS group_source,
    CASE
        WHEN LOWER(utm.utm_term) LIKE '%search%' OR LOWER(utm.utm_content) LIKE '%search%'
          OR LOWER(utm.utm_medium) LIKE '%search%' OR LOWER(l.chat_source) LIKE '%search%'      THEN 'Search'
        WHEN LOWER(utm.utm_term) LIKE '%discovery%' OR LOWER(utm.utm_content) LIKE '%discovery%'
          OR LOWER(utm.utm_medium) LIKE '%discovery%' OR LOWER(utm.utm_term) LIKE '%demandgen%'
          OR LOWER(utm.utm_content) LIKE '%demandgen%' OR LOWER(utm.utm_medium) LIKE '%demandgen%'
          OR LOWER(l.chat_source) LIKE '%discovery%' OR LOWER(l.chat_source) LIKE '%demandgen%' THEN 'Discovery'
        ELSE 'Non-UTM'
    END                                                                            AS source_bucket,
    curr_st.name                                                                   AS current_stage,
    l.client_id,
    il.last_connect,
    il.last_connect_time,
    il.last_comment,
    ia.internal_status_comments,
    sa.stage_comments,
    CASE WHEN b.lead_closing_reason IS NOT NULL
         THEN CONCAT(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ': ', b.lead_closing_reason,
                     ' - ', COALESCE(DATE_FORMAT(b.closing_reason_at, '%Y-%m-%d %H:%i'), ''))
    END                                                                            AS closing_reason,
    COALESCE(cc.attempts, 0)  + COALESCE(dc.attempts, 0)                           AS call_attempts,
    COALESCE(cc.connected, 0) + COALESCE(dc.connected, 0)                          AS call_count,
    COALESCE(cc.talk, 0)      + COALESCE(dc.talk, 0)                               AS duration
FROM base b
JOIN leads l                     ON l.id = b.lead_id
LEFT JOIN users u                ON u.id = b.userid
LEFT JOIN roles r                ON r.id = u.role_id
LEFT JOIN user_meta um           ON um.user_id = u.id
LEFT JOIN regions re             ON re.id = um.region_id
LEFT JOIN region_parents rp      ON rp.id = re.parent_region_id
LEFT JOIN projects p             ON p.id = l.project_id
LEFT JOIN regions reg            ON reg.id = p.region_id
LEFT JOIN region_parents rpu     ON rpu.id = reg.parent_region_id
LEFT JOIN object_stages curr_os  ON curr_os.id = l.lead_stage_id
LEFT JOIN stages curr_st         ON curr_st.id = curr_os.stage_id
LEFT JOIN sources s              ON s.id = l.source_id
LEFT JOIN group_sources gs       ON gs.id = s.group_source_id
LEFT JOIN clients cl             ON cl.id = l.client_id
LEFT JOIN utms utm               ON utm.id = l.utm_id
LEFT JOIN ish_agg ia             ON ia.lead_id = b.lead_id
LEFT JOIN ish_last il            ON il.lead_id = b.lead_id
LEFT JOIN stage_agg sa           ON sa.lead_id = b.lead_id
LEFT JOIN crm_calls cc           ON cc.lead_id = b.lead_id
LEFT JOIN device_calls dc        ON dc.lead_id = b.lead_id
WHERE (rpu.id IS NULL OR rpu.id NOT IN (16, 25));
