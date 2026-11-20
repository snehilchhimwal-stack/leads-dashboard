/*
 * BACKUP — the Coefficient "leads" import query exactly as it was live on 20 Nov 2026,
 * before switching to coefficient_leads_import_v2.sql. To roll back, paste this whole
 * file back into the Coefficient MySQL import for the `leads` tab and refresh.
 * (Text below this header is verbatim as supplied by Snehil on 20 Nov 2026.)
 */
/*
 * ==============================================================================
 * LEAD PERFORMANCE & HISTORY REPORT
 * ==============================================================================
 * NOTE: This query deliberately contains no Coefficient parameter tokens
 * (double-curly-brace syntax). Coefficient scans query text for that syntax and
 * tries to resolve each occurrence to a spreadsheet range, including inside SQL
 * comments. Do not add any unless a matching SQL Parameter has been created in
 * the import first.
 *
 * REGION COVERAGE
 * ---------------
 * Region is resolved from TWO independent chains so it is never blank:
 *   RM chain      : users -> user_meta -> regions (re) -> region_parents (rp)
 *   Project chain : leads -> projects -> regions (reg) -> region_parents (rpu)
 * region = COALESCE(RM region parent, project region parent, 'Unassigned').
 * rm_region / project_region are also returned so you can see which chain
 * supplied the value and spot data gaps.
 *
 * The users join no longer filters on is_active / deleted_at. That filter was
 * nulling out u for inactive reps, which in turn nulled the role and region
 * chains and dropped those rows. rm_is_active is returned as a column instead,
 * so filter in the sheet if you want active reps only.
 *
 * The role filter (r.id IN (8,10,37,7)) is COMMENTED OUT below. In the WHERE
 * clause it behaved as an inner join and removed every lead whose rep was
 * inactive or held any other role, which is the main reason whole regions were
 * missing. Re-enable only if you accept that trade-off.
 *
 * Timestamps (lead_created_at, last_connect_time) are read AS-IS from the
 * source columns, which are already IST. No CONVERT_TZ is applied.
 *
 * Window is exactly 7 days including today: CURDATE() - INTERVAL 6 DAY up to
 * CURDATE() + INTERVAL 1 DAY (exclusive).
 *
 * TWO SEPARATE CALL METRICS:
 *   call_attempts = every dial logged (type 1 & 4), any caller, connected or
 *                   not. Missed / failed / unanswered dials ARE counted.
 *   call_count    = dials that actually connected (conversation_duration > 0).
 *   duration      = total talk time across connected calls.
 *
 * All group sources are returned (no gs.id restriction). source_bucket's
 * Search / Discovery split is UTM-driven and only meaningful for Google leads.
 * ==============================================================================
 */

-- 1. TEAM HIERARCHY (Recursive CTE)
WITH RECURSIVE TeamCTE AS (
    SELECT
        child_id, parent_id,
        1 AS level
    FROM team_mappings
    WHERE parent_id = 5022
      AND deleted_at IS NULL

    UNION ALL

    SELECT
        t.child_id, t.parent_id,
        r.level + 1 AS level
    FROM team_mappings t
    INNER JOIN TeamCTE r ON t.parent_id = r.child_id
    WHERE r.level < 15  -- Safety limit to prevent infinite loops
      AND t.deleted_at IS NULL
),

-- 2. TEAM FILTER
FilterTeam AS (
    SELECT child_id FROM TeamCTE
    UNION
    SELECT 35083
),

-- 3. CALL STATS PRE-AGGREGATION (attempts vs connected)
call_stats AS (
    SELECT
        cl.object_id AS lead_id,
        COUNT(DISTINCT cl.id) AS attempt_count,
        COUNT(DISTINCT CASE WHEN cd.conversation_duration > 0 THEN cl.id END) AS connected_count,
        COALESCE(SUM(cd.conversation_duration), 0) AS talk_duration
    FROM engage.call_logs cl
    LEFT JOIN engage.call_details cd ON cd.call_log_id = cl.id
    WHERE cl.type IN (1, 4)
      AND cl.created_at >= CURDATE() - INTERVAL 6 DAY
      AND cl.created_at < CURDATE() + INTERVAL 1 DAY
    GROUP BY cl.object_id
),

-- 4. DEVICE CALL STATS PRE-AGGREGATION (client-level, not lead-level)
device_call_stats AS (
    SELECT
        client_id,
        COUNT(id) AS dev_attempt_count,
        COUNT(CASE WHEN duration > 0 THEN id END) AS dev_connected_count,
        COALESCE(SUM(duration), 0) AS dev_talk_duration
    FROM engage.device_call_logs
    WHERE created_at >= CURDATE() - INTERVAL 6 DAY
      AND created_at < CURDATE() + INTERVAL 1 DAY
    GROUP BY client_id
),

-- 4b. MOST RECENT LEAD PER CLIENT
-- Device metrics attach only here so they aren't duplicated across every lead
-- belonging to the same client.
client_latest_lead AS (
    SELECT client_id, lead_id
    FROM (
        SELECT
            client_id,
            id AS lead_id,
            ROW_NUMBER() OVER (PARTITION BY client_id ORDER BY created_at DESC, id DESC) AS rn
        FROM leads
        WHERE deleted_at IS NULL
          AND created_at >= CURDATE() - INTERVAL 6 DAY
          AND created_at < CURDATE() + INTERVAL 1 DAY
    ) ranked
    WHERE rn = 1
),

-- 5. CLAIMED LEADS DATASET
all_leads AS (
    SELECT
        lc.user_id AS userid,

        GROUP_CONCAT(DISTINCT COALESCE(CONCAT(u.first_name, ' ', u.last_name), 'Unknown') SEPARATOR ', ') AS RM,
        GROUP_CONCAT(DISTINCT COALESCE(CONCAT(ut.first_name, ' ', ut.last_name), 'Unknown') SEPARATOR ', ') AS TL,

        l.client_id,
        l.id AS lead_id,

        -- REGION: RM chain first, then project chain, never blank
        COALESCE(rp.name, rpu.name, 'Unassigned') AS region,
        re.name  AS rm_region,
        reg.name AS project_region,
        MAX(u.is_active) AS rm_is_active,
        MAX(r.name) AS rm_role,

        l.project_id,
        p.name AS project,

        MAX(curr_st.name) AS current_stage,

        -- Already IST at source: no conversion applied
        l.created_at AS lead_created_at,
        lc.created_at as lead_assigned_at,
        MIN(case when os.stage_id = 3 then os.created_at end) as opp_at,
        lc.deleted_at as lead_closed_at,
        lc.closing_reason as lead_closing_reason,
        lc.comment as lead_closing_comment,
        ish.created_at AS last_connect_time,
        gs.name AS group_source,
        CASE
            WHEN LOWER(utm.utm_term)     LIKE '%search%'
              OR LOWER(utm.utm_content)  LIKE '%search%'
              OR LOWER(utm.utm_medium)   LIKE '%search%'
              OR LOWER(l.chat_source)    LIKE '%search%'     THEN 'Search'
            WHEN LOWER(utm.utm_term)     LIKE '%discovery%'
              OR LOWER(utm.utm_content)  LIKE '%discovery%'
              OR LOWER(utm.utm_medium)   LIKE '%discovery%'
              OR LOWER(utm.utm_term)     LIKE '%demandgen%'
              OR LOWER(utm.utm_content)  LIKE '%demandgen%'
              OR LOWER(utm.utm_medium)   LIKE '%demandgen%'
              OR LOWER(l.chat_source)    LIKE '%discovery%'
              OR LOWER(l.chat_source)    LIKE '%demandgen%'  THEN 'Discovery'
            ELSE 'Non-UTM'
        END AS source_bucket,
        c.name AS client,
        cs.name AS last_connect,
        ish.comment AS last_comment,

        GROUP_CONCAT(
            DISTINCT CONCAT(
                COALESCE(CONCAT(ishu.first_name, ' ', ishu.last_name), 'Unknown'),
                ': ',
                ish.comment,
                ' - ',
                COALESCE(DATE_FORMAT(ish.created_at, '%Y-%m-%d %H:%i'), '')
            )
            ORDER BY ish.created_at
            SEPARATOR ' | '
        ) AS internal_status_comments,

        GROUP_CONCAT(
            DISTINCT CONCAT(
                COALESCE(CONCAT(ua.first_name," ",ua.last_name),''), ': ', st.name, ' - ', os.comments, ' - ', COALESCE(os.created_at, ''))
            ORDER BY os.id
            SEPARATOR ' | '
        ) AS stage_comments,

        GROUP_CONCAT(
            DISTINCT CONCAT(
                COALESCE(CONCAT(u.first_name," ",u.last_name),''), ': ', lc.closing_reason, " - ", COALESCE(lc.updated_at,''))
            ORDER BY lc.id
            SEPARATOR ' | '
        ) AS closing_reason,

        COALESCE(cst.attempt_count, 0)
            + CASE WHEN l.id = llc.lead_id THEN COALESCE(dcs.dev_attempt_count, 0) ELSE 0 END AS call_attempts,
        COALESCE(cst.connected_count, 0)
            + CASE WHEN l.id = llc.lead_id THEN COALESCE(dcs.dev_connected_count, 0) ELSE 0 END AS call_count,
        COALESCE(cst.talk_duration, 0)
            + CASE WHEN l.id = llc.lead_id THEN COALESCE(dcs.dev_talk_duration, 0) ELSE 0 END AS duration

    FROM lead_claims lc

    -- [Core Lead & User Joins]
    -- users is joined WITHOUT an is_active filter so the role and region
    -- chains below still resolve for inactive reps.
    LEFT JOIN leads l ON lc.lead_id = l.id AND l.deleted_at IS NULL
    LEFT JOIN users u ON u.id = lc.user_id
    LEFT JOIN team_mappings tm ON tm.child_id = lc.user_id
    LEFT JOIN users ut ON ut.id = tm.parent_id

    -- [Project region chain]
    LEFT JOIN projects p ON p.id = l.project_id
    LEFT JOIN regions reg ON reg.id = p.region_id
    LEFT JOIN region_parents rpu ON reg.parent_region_id = rpu.id

    -- [RM role + region chain]
    LEFT JOIN roles r ON r.id = u.role_id
    LEFT JOIN user_meta um ON u.id = um.user_id
    LEFT JOIN regions re ON re.id = um.region_id
    LEFT JOIN region_parents rp ON re.parent_region_id = rp.id

    -- [Stage History Joins] (1-to-Many)
    LEFT JOIN object_stages os ON l.id = os.object_id
    LEFT JOIN users ua ON ua.id = os.user_id
    LEFT JOIN stages st ON os.stage_id = st.id

    -- [Current Stage Joins] (1-to-1)
    LEFT JOIN object_stages curr_os ON l.lead_stage_id = curr_os.id
    LEFT JOIN stages curr_st ON curr_os.stage_id = curr_st.id

    -- [Source & Client Joins]
    LEFT JOIN sources s ON l.source_id = s.id
    LEFT JOIN group_sources gs ON s.group_source_id = gs.id
    LEFT JOIN clients c ON l.client_id = c.id
    LEFT JOIN utms utm ON l.utm_id = utm.id

    -- [Internal Status History Joins] (1-to-Many)
    LEFT JOIN internal_status_history ish ON ish.lead_id = l.id
    LEFT JOIN users ishu ON ish.created_by = ishu.id
    LEFT JOIN calling_status cs ON ish.calling_status = cs.id

    -- [Call Stat Joins]
    LEFT JOIN call_stats cst ON cst.lead_id = l.id
    LEFT JOIN device_call_stats dcs ON dcs.client_id = c.id
    LEFT JOIN client_latest_lead llc ON llc.client_id = c.id

    WHERE lc.user_id IN (SELECT child_id FROM FilterTeam)
      AND lc.created_at >= CURDATE() - INTERVAL 6 DAY
      AND lc.created_at < CURDATE() + INTERVAL 1 DAY
      AND l.id IS NOT NULL -- exclude claims whose lead is deleted or missing
      -- AND gs.id IN (1)                  -- Google only (disabled: all sources)
      -- AND r.id IN (8, 10, 37, 7)        -- role filter (disabled: was dropping regions)
      AND rpu.id NOT IN (16, 25)                  -- specific region parent
    GROUP BY l.id, lc.user_id
),

-- 6. DIRECTLY ASSIGNED LEADS DATASET
direct AS (
    SELECT
        al.assign_to AS userid,

        GROUP_CONCAT(DISTINCT COALESCE(CONCAT(u.first_name, ' ', u.last_name), 'Unknown') SEPARATOR ', ') AS RM,
        GROUP_CONCAT(DISTINCT COALESCE(CONCAT(ut.first_name, ' ', ut.last_name), 'Unknown') SEPARATOR ', ') AS TL,

        l.client_id,
        l.id AS lead_id,

        COALESCE(rp.name, rpu.name, 'Unassigned') AS region,
        re.name  AS rm_region,
        reg.name AS project_region,
        MAX(u.is_active) AS rm_is_active,
        MAX(r.name) AS rm_role,

        l.project_id,
        p.name AS project,

        MAX(curr_st.name) AS current_stage,

        l.created_at AS lead_created_at,
        al.created_at as lead_assigned_at,
        MIN(case when os.stage_id = 3 then os.created_at end) as opp_at,
        case when l.closing_reason is not null then l.updated_at else null end as lead_closed_at,
        l.closing_reason as lead_closing_reason,
        "" as lead_closing_comment,
        ish.created_at AS last_connect_time,
        gs.name AS group_source,
        CASE
            WHEN LOWER(utm.utm_term)     LIKE '%search%'
              OR LOWER(utm.utm_content)  LIKE '%search%'
              OR LOWER(utm.utm_medium)   LIKE '%search%'
              OR LOWER(l.chat_source)    LIKE '%search%'     THEN 'Search'
            WHEN LOWER(utm.utm_term)     LIKE '%discovery%'
              OR LOWER(utm.utm_content)  LIKE '%discovery%'
              OR LOWER(utm.utm_medium)   LIKE '%discovery%'
              OR LOWER(utm.utm_term)     LIKE '%demandgen%'
              OR LOWER(utm.utm_content)  LIKE '%demandgen%'
              OR LOWER(utm.utm_medium)   LIKE '%demandgen%'
              OR LOWER(l.chat_source)    LIKE '%discovery%'
              OR LOWER(l.chat_source)    LIKE '%demandgen%'  THEN 'Discovery'
            ELSE 'Non-UTM'
        END AS source_bucket,
        c.name AS client,
        cs.name AS last_connect,
        ish.comment AS last_comment,

        GROUP_CONCAT(
            DISTINCT CONCAT(ish.comment, " - ", COALESCE(ish.action_date, ''))
            ORDER BY ish.action_date
            SEPARATOR ' | '
        ) AS internal_status_comments,

        GROUP_CONCAT(
            DISTINCT CONCAT(
                COALESCE(CONCAT(ua.first_name," ",ua.last_name),''), ': ', st.name, ' - ', os.comments, ' - ', COALESCE(os.created_at, ''))
            ORDER BY os.id
            SEPARATOR ' | '
        ) AS stage_comments,

        GROUP_CONCAT(
            DISTINCT CONCAT(
                COALESCE(CONCAT(u.first_name," ",u.last_name),''), ': ', l.closing_reason, " - ", COALESCE(l.updated_at,''))
            ORDER BY l.id
            SEPARATOR ' | '
        ) AS closing_reason,

        COALESCE(cst.attempt_count, 0)
            + CASE WHEN l.id = llc.lead_id THEN COALESCE(dcs.dev_attempt_count, 0) ELSE 0 END AS call_attempts,
        COALESCE(cst.connected_count, 0)
            + CASE WHEN l.id = llc.lead_id THEN COALESCE(dcs.dev_connected_count, 0) ELSE 0 END AS call_count,
        COALESCE(cst.talk_duration, 0)
            + CASE WHEN l.id = llc.lead_id THEN COALESCE(dcs.dev_talk_duration, 0) ELSE 0 END AS duration

    FROM leads l

    -- [Assignment & User Joins]
    LEFT JOIN assign_leads al ON l.id = al.lead_id
    LEFT JOIN users u ON u.id = al.assign_to
    LEFT JOIN team_mappings tm ON tm.child_id = al.assign_to
    LEFT JOIN users ut ON ut.id = tm.parent_id

    -- [Project region chain]
    LEFT JOIN projects p ON p.id = l.project_id
    LEFT JOIN regions reg ON reg.id = p.region_id
    LEFT JOIN region_parents rpu ON reg.parent_region_id = rpu.id

    -- [RM role + region chain]
    LEFT JOIN roles r ON r.id = u.role_id
    LEFT JOIN user_meta um ON u.id = um.user_id
    LEFT JOIN regions re ON re.id = um.region_id
    LEFT JOIN region_parents rp ON re.parent_region_id = rp.id

    -- [Stage History Joins]
    LEFT JOIN object_stages os ON l.id = os.object_id
    LEFT JOIN users ua ON ua.id = os.user_id
    LEFT JOIN stages st ON os.stage_id = st.id

    -- [Current Stage Joins]
    LEFT JOIN object_stages curr_os ON l.lead_stage_id = curr_os.id
    LEFT JOIN stages curr_st ON curr_os.stage_id = curr_st.id

    -- [Source & Client Joins]
    LEFT JOIN sources s ON l.source_id = s.id
    LEFT JOIN group_sources gs ON s.group_source_id = gs.id
    LEFT JOIN clients c ON l.client_id = c.id
    LEFT JOIN utms utm ON l.utm_id = utm.id

    -- [Internal Status History Joins]
    LEFT JOIN internal_status_history ish ON ish.lead_id = l.id
    LEFT JOIN calling_status cs ON ish.calling_status = cs.id

    -- [Call Stat Joins]
    LEFT JOIN call_stats cst ON cst.lead_id = l.id
    LEFT JOIN device_call_stats dcs ON dcs.client_id = c.id
    LEFT JOIN client_latest_lead llc ON llc.client_id = c.id

    -- [Anti-Join: Exclude leads already in the 'all_leads' (claimed) dataset]
    LEFT JOIN lead_claims lc_excl ON lc_excl.lead_id = l.id

    WHERE al.assign_to IN (SELECT child_id FROM FilterTeam)
      AND l.created_at >= CURDATE() - INTERVAL 6 DAY
      AND l.created_at < CURDATE() + INTERVAL 1 DAY
      AND l.deleted_at IS NULL
      AND lc_excl.lead_id IS NULL
      -- AND gs.id IN (1)                  -- Google only (disabled: all sources)
      -- AND r.id IN (8, 10, 37, 7)        -- role filter (disabled: was dropping regions)
      AND rpu.id NOT IN (16, 25)                  -- specific region parent

    GROUP BY l.id, al.assign_to
)

-- 7. FINAL OUTPUT
SELECT
    region,
    rm_region,
    project_region,
    lead_id,
    RM,
    TL,
    rm_role,
    rm_is_active,
    project,
    client,
    lead_created_at,
    lead_assigned_at,
    opp_at,
    lead_closed_at,
    lead_closing_reason,
    lead_closing_comment,
    group_source,
    source_bucket,
    current_stage,
    client_id,
    last_connect,
    last_connect_time,
    last_comment,
    internal_status_comments,
    stage_comments,
    closing_reason,
    call_attempts,
    call_count,
    duration
FROM (
    SELECT * FROM all_leads
    UNION ALL
    SELECT * FROM direct
) combined;
