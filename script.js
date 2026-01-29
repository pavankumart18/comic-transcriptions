import { asyncLLM } from "asyncllm";
import { bootstrapAlert } from "bootstrap-alert";
import { openaiConfig } from "bootstrap-llm-provider";
import hljs from "highlight.js";
import { html, render } from "lit-html";
import { unsafeHTML } from "lit-html/directives/unsafe-html.js";
import { Marked } from "marked";
import { parse } from "partial-json";
import saveform from "saveform";

// Helpers
const $ = (selector, el = document) => el.querySelector(selector);
const loading = html`<div class="spinner-border" role="status"><span class="visually-hidden">Loading...</span></div>`;

// State
let dashboardData = null;
let modalInstance = null;
let sortState = { col: 'id', width: 0, asc: true }; // 'id', 'average', or model_name

// Initialize
(async function init() {
    try {
        const res = await fetch('data/dashboard_data.json');
        dashboardData = await res.json();

        // Render Dashboard Table
        renderTable();
        renderAggregatedTable();

        // Initialize Modal
        modalInstance = new bootstrap.Modal(document.getElementById('detailModal'));

    } catch (e) {
        bootstrapAlert({ color: "danger", title: "Error loading data", body: "Could not load dashboard_data.json." });
        console.error(e);
    }
})();

function renderTable() {
    $("#loading").classList.add("d-none");

    const models = dashboardData.all_models.sort();

    // Sorting Logic
    const sortedStrips = [...dashboardData.strips].sort((a, b) => {
        let valA, valB;

        if (sortState.col === 'id') {
            valA = a.id;
            valB = b.id;
        } else if (sortState.col === 'average') {
            valA = a.average;
            valB = b.average;
        } else {
            // Sort by specific model score
            // Handle missing scores (treat as -1 for sorting to put at bottom/top)
            valA = a.models[sortState.col] ? a.models[sortState.col].score : -1;
            valB = b.models[sortState.col] ? b.models[sortState.col].score : -1;
        }

        if (valA < valB) return sortState.asc ? -1 : 1;
        if (valA > valB) return sortState.asc ? 1 : -1;
        return 0;
    });

    const getSortIcon = (col) => {
        if (sortState.col !== col) return '';
        return sortState.asc ? html`<i class="bi bi-caret-up-fill sort-icon"></i>` : html`<i class="bi bi-caret-down-fill sort-icon"></i>`;
    };

    render(html`
        <div class="card shadow-sm border-0 overflow-hidden">
            <div class="table-responsive">
                <table class="table table-hover mb-0 align-middle" style="width: auto; min-width: 100%;">
                    <thead class="text-secondary text-uppercase small fw-bold">
                        <tr>
                            <th class="ps-4 sortable" @click=${() => sortBy('id')} style="width: 140px;">
                                Date / ID ${getSortIcon('id')}
                            </th>
                            ${models.map(m => html`
                                <th class="text-center sortable" @click=${() => sortBy(m)} style="width: 100px;">
                                    ${m} ${getSortIcon(m)}
                                </th>
                            `)}
                            <th class="text-end pe-4 sortable" @click=${() => sortBy('average')} style="width: 100px;">
                                Average ${getSortIcon('average')}
                            </th>
                        </tr>
                    </thead>
                    <tbody class="border-top-0">
                        ${sortedStrips.map(strip => html`
                            <tr class="cursor-pointer" @click=${() => openModal(strip.id)} style="cursor: pointer;">
                                <td class="ps-4 fw-medium text-primary">${strip.id}</td>
                                ${models.map(m => {
        const score = strip.models[m] ? strip.models[m].score : '-';
        return html`<td class="p-0 text-center border-start border-end" style="width: 100px;">
                                        <div class="score-badge ${getScoreClass(score)}">${score}${score !== '-' ? '%' : ''}</div>
                                    </td>`;
    })}
                                <td class="p-0 text-center border-start bg-body-tertiary" style="width: 100px;">
                                    <div class="score-badge ${getScoreClass(strip.average)}">${strip.average}%</div>
                                </td>
                            </tr>
                        `)}
                    </tbody>
                    <tfoot class="fw-bold text-secondary border-top">
                        <tr>
                            <td class="ps-4">Model Average</td>
                            ${models.map(m => html`
                                <td class="p-0 text-center">
                                    <div class="score-badge ${getScoreClass(dashboardData.model_stats[m])}">${dashboardData.model_stats[m]}%</div>
                                </td>
                            `)}
                            <td></td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    `, $("#output"));
}

function sortBy(col) {
    if (sortState.col === col) {
        sortState.asc = !sortState.asc;
    } else {
        sortState.col = col;
        // Default sort direction: ID -> asc, Scores -> desc
        sortState.asc = (col === 'id');
    }
    renderTable();
}

function getScoreClass(score) {
    if (score === '-') return 'text-muted';
    const s = parseFloat(score);
    if (s >= 90) return 'bg-score-high';
    if (s >= 80) return 'bg-score-good';
    if (s >= 70) return 'bg-score-mid';
    if (s >= 50) return 'bg-score-low';
    return 'bg-score-bad';
}

// Helper to get score class based on percentage of max points
function getCompScoreClass(val, max) {
    const pct = (val / max) * 100;
    if (pct >= 90) return 'bg-score-high';
    if (pct >= 80) return 'bg-score-good';
    if (pct >= 70) return 'bg-score-mid';
    if (pct >= 50) return 'bg-score-low';
    return 'bg-score-bad';
}

function openModal(id) {
    const strip = dashboardData.strips.find(s => s.id === id);
    if (!strip) return;

    // Set Text Content
    $("#detailModalLabel").textContent = `Analysis: ${id}`;

    // Elements
    const img = $("#modal-img");
    const loader = $("#img-loader");
    const viewImageBtn = $("#view-image-btn");

    // Reset State
    img.classList.add('d-none');
    loader.classList.remove('d-none');
    // We can show the view button immediately as it's just the direct link
    viewImageBtn.classList.remove('d-none');

    // Set URLs
    viewImageBtn.href = strip.url;

    // Load Image
    img.src = strip.url;

    img.onerror = () => {
        loader.classList.add('d-none');
        img.classList.add('d-none');
        // Image failed, but user can still try the link
    };

    img.onload = () => {
        loader.classList.add('d-none');
        img.classList.remove('d-none');
    };

    // Render Content
    render(html`
        <!-- Section A: Ground Truth -->
        <div class="card border-0 bg-body-tertiary rounded-3">
            <div class="card-header bg-transparent border-0 text-uppercase small text-body-secondary fw-bold pb-0">Section A — Ground Truth</div>
            <div class="card-body">
                <div class="font-monospace small">
                    ${renderTranscript(strip.ground_truth)}
                </div>
            </div>
        </div>

        <!-- Section B: Leaderboard -->
        <div>
            <h6 class="text-uppercase small text-body-secondary fw-bold mb-3">Section B — Model Performance</h6>
            <div class="table-responsive border rounded-3">
                <table class="table mb-0 align-middle">
                    <thead class="text-secondary text-uppercase small fw-bold">
                        <tr>
                            <th class="ps-3">Model</th>
                            <th class="text-center" style="width: 100px;">Score</th>
                            <th class="text-center" style="width: 100px;">Text (40)</th>
                            <th class="text-center" style="width: 100px;">Spkr (25)</th>
                            <th class="text-center" style="width: 100px;">Caps (15)</th>
                            <th class="text-center" style="width: 100px;">Panel (10)</th>
                            <th class="text-center" style="width: 100px;">Halluc (10)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${Object.entries(strip.models)
            .map(([k, v]) => ({ name: k, ...v }))
            .sort((a, b) => b.score - a.score)
            .map(m => renderModelRow(m))}
                    </tbody>
                </table>
            </div>
        </div>
        
        <!-- Section C: Notes -->
        <div>
             <h6 class="text-uppercase small text-body-secondary fw-bold mb-3">Section C — Judge's Notes</h6>
             <div class="d-flex flex-column gap-3">
                ${Object.entries(strip.models)
            .map(([k, v]) => ({ name: k, ...v }))
            .sort((a, b) => b.score - a.score)
            .map(m => html`
                        <div class="card border-0 shadow-sm">
                            <div class="card-body py-3">
                                <div class="d-flex justify-content-between align-items-start">
                                     <div>
                                        <strong class="d-block text-body-emphasis small mb-1">${m.name} (${m.score}%)</strong>
                                        ${m.metrics.notes ? html`<p class="mb-0 small text-body-secondary">${m.metrics.notes}</p>` : html`<span class="small text-muted fst-italic">No notes</span>`}
                                     </div>
                                     <button class="btn btn-sm btn-link text-secondary p-0" @click=${(e) => toggleDetail(e, m.name)} title="Toggle Output" style="text-decoration: none;">
                                         <i class="bi bi-chevron-down" id="icon-${m.name}"></i>
                                     </button>
                                </div>
                                <div class="d-none mt-3 pt-3 border-top" id="detail-${m.name}">
                                     <h6 class="text-uppercase small text-body-secondary fw-bold mb-2" style="font-size: 0.7rem;">Reference Transcript</h6>
                                     <div class="font-monospace small bg-body border rounded p-3">
                                        ${renderTranscriptOutput(m.full_output)}
                                     </div>
                                </div>
                            </div>
                        </div>
                    `)}
             </div>
        </div>
    `, $("#modal-content"));

    modalInstance.show();
}

function renderModelRow(m) {
    // Re-use logic for row styling if needed, or keep simple text score for modal detail
    // Modal detail doesn't need background badges necessarily, but let's keep it consistent if desired.
    // Use badges here too? The user said "Visulization Improvements".
    // For the modal detail table, let's use the badges for the Score column.

    return html`
        <tr>
            <td class="ps-3 fw-medium text-body-emphasis small">${m.name}</td>
            <td class="p-0 text-center border-start border-end" style="width: 100px;">
                <div class="score-badge ${getScoreClass(m.score)}">${m.score}</div>
            </td>
            <td class="p-0 text-center border-end" style="width: 100px;">
                <div class="score-badge ${getCompScoreClass(m.metrics.text_accuracy, 40)}">${m.metrics.text_accuracy}</div>
            </td>
            <td class="p-0 text-center border-end" style="width: 100px;">
                <div class="score-badge ${getCompScoreClass(m.metrics.speaker_accuracy, 25)}">${m.metrics.speaker_accuracy}</div>
            </td>
            <td class="p-0 text-center border-end" style="width: 100px;">
                <div class="score-badge ${getCompScoreClass(m.metrics.capitalization_accuracy, 15)}">${m.metrics.capitalization_accuracy}</div>
            </td>
            <td class="p-0 text-center border-end" style="width: 100px;">
                <div class="score-badge ${getCompScoreClass(m.metrics.panel_alignment, 10)}">${m.metrics.panel_alignment}</div>
            </td>
            <td class="p-0 text-center" style="width: 100px;">
                <div class="score-badge ${getCompScoreClass(m.metrics.hallucination_penalty, 10)}">${(10 - parseFloat(m.metrics.hallucination_penalty)).toFixed(1)}</div>
            </td>
        </tr>
    `;
}

function toggleDetail(e, name) {
    const row = document.getElementById(`detail-${name}`);
    const icon = document.getElementById(`icon-${name}`);
    if (row.classList.contains('d-none')) {
        row.classList.remove('d-none');
        if (icon) icon.classList.replace('bi-chevron-down', 'bi-chevron-up');
    } else {
        row.classList.add('d-none');
        if (icon) icon.classList.replace('bi-chevron-up', 'bi-chevron-down');
    }
}

function renderTranscriptOutput(data) {
    // Check if it's a string needing parse
    let parsedData = data;
    if (typeof data === 'string') {
        try { parsedData = JSON.parse(data); } catch (e) { }
    }

    // Try to find panels
    let panels = null;
    if (parsedData) {
        if (Array.isArray(parsedData)) panels = parsedData;
        else if (Array.isArray(parsedData.panels)) panels = parsedData.panels;
    }

    if (panels && panels.length > 0) {
        return renderTranscript(panels);
    } else {
        // Fallback to JSON
        const json = JSON.stringify(parsedData, null, 2);
        return html`<pre class="m-0 text-success bg-body-tertiary p-3 rounded"><code>${json}</code></pre>`;
    }
}

function renderTranscript(panels) {
    if (!panels) return html`<span class="text-body-secondary fst-italic">No data</span>`;
    return panels.map(p => html`
        <div class="mb-3 border-bottom pb-3 last-border-0">
            <div class="text-uppercase text-body-secondary fw-bold small mb-2">Panel ${p.panel || '?'}</div>
            ${(p.dialogue || []).map(d => html`
                <div class="ps-3 border-start border-3 mb-1">
                    <span class="fw-bold text-body-emphasis">${d.speaker || 'Unknown'}:</span>
                    <span class="text-body-secondary">"${d.text || ''}"</span>
                </div>
            `)}
            ${(!p.dialogue || p.dialogue.length === 0) ? html`<div class="ps-3 text-body-secondary fst-italic small">No dialogue</div>` : ''}
        </div>
    `);
}

// New state for aggregated table sorting
let aggSortState = { col: 'score', asc: false };

function renderAggregatedTable() {
    const models = dashboardData.all_models;
    const stats = {};

    // Initialize stats for each model
    models.forEach(m => {
        stats[m] = {
            count: 0,
            score: 0,
            text_accuracy: 0,
            speaker_accuracy: 0,
            capitalization_accuracy: 0,
            panel_alignment: 0,
            hallucination_penalty: 0
        };
    });

    // Accumulate data
    dashboardData.strips.forEach(strip => {
        models.forEach(m => {
            const data = strip.models[m];
            if (data) {
                stats[m].count++;
                stats[m].score += parseFloat(data.score) || 0;
                stats[m].text_accuracy += parseFloat(data.metrics.text_accuracy) || 0;
                stats[m].speaker_accuracy += parseFloat(data.metrics.speaker_accuracy) || 0;
                stats[m].capitalization_accuracy += parseFloat(data.metrics.capitalization_accuracy) || 0;
                stats[m].panel_alignment += parseFloat(data.metrics.panel_alignment) || 0;
                stats[m].hallucination_penalty += parseFloat(data.metrics.hallucination_penalty) || 0;
            }
        });
    });

    // Compute averages
    let aggregatedData = models.map(m => {
        const c = stats[m].count || 1; // Avoid division by zero
        // Hallucination penalty is a deduction, so we display it as negative, but for sorting we might want the magnitude?
        // Let's store the raw average deduction (positive number)
        return {
            name: m,
            count: stats[m].count, // Kept in data, removed from view
            score: parseFloat((stats[m].score / c).toFixed(1)),
            text_accuracy: parseFloat((stats[m].text_accuracy / c).toFixed(1)),
            speaker_accuracy: parseFloat((stats[m].speaker_accuracy / c).toFixed(1)),
            capitalization_accuracy: parseFloat((stats[m].capitalization_accuracy / c).toFixed(1)),
            panel_alignment: parseFloat((stats[m].panel_alignment / c).toFixed(1)),
            hallucination_penalty: parseFloat((stats[m].hallucination_penalty / c).toFixed(1))
        };
    });

    // Sorting Logic
    aggregatedData.sort((a, b) => {
        let valA = a[aggSortState.col];
        let valB = b[aggSortState.col];

        // Specific handling if we were sorting by name strings
        if (aggSortState.col === 'name') {
            if (valA < valB) return aggSortState.asc ? -1 : 1;
            if (valA > valB) return aggSortState.asc ? 1 : -1;
            return 0;
        }

        // Numeric sort
        // For hallucination, lower penalty is better? Or higher penalty deduction (more negative) is worse?
        // Val stored is positive average penalty. Lower is better.
        // If sorting asc: small penalty first (better).
        // If sorting desc: huge penalty first (worse).

        // Let's stick to standard numeric sort:
        if (valA < valB) return aggSortState.asc ? -1 : 1;
        if (valA > valB) return aggSortState.asc ? 1 : -1;
        return 0;
    });

    const getAggSortIcon = (col) => {
        if (aggSortState.col !== col) return '';
        return aggSortState.asc ? html`<i class="bi bi-caret-up-fill sort-icon"></i>` : html`<i class="bi bi-caret-down-fill sort-icon"></i>`;
    };

    const sortAgg = (col) => {
        if (aggSortState.col === col) {
            aggSortState.asc = !aggSortState.asc;
        } else {
            aggSortState.col = col;
            aggSortState.asc = (col === 'name'); // Default asc for name, desc for numbers usually (but let's click to flip)
        }
        renderAggregatedTable();
    };



    render(html`
        <div class="card shadow-sm border-0 mb-4 overflow-hidden">
            <div class="card-header bg-body-tertiary border-0 py-3">
                <h5 class="card-title mb-0 fw-bold text-uppercase small text-body-secondary"><i class="bi bi-trophy me-2"></i>Overall Model Statistics</h5>
            </div>
            <div class="table-responsive">
                <table class="table table-hover mb-0 align-middle" style="width: auto; min-width: 100%;">
                    <thead class="text-secondary text-uppercase small fw-bold">
                        <tr>
                            <th class="ps-4 sortable" @click=${() => sortAgg('name')}>Model ${getAggSortIcon('name')}</th>
                            <th class="text-center sortable" @click=${() => sortAgg('score')} style="width: 100px;">Avg Score ${getAggSortIcon('score')}</th>
                            <th class="text-center sortable" @click=${() => sortAgg('text_accuracy')} style="width: 100px;">Text (40) ${getAggSortIcon('text_accuracy')}</th>
                            <th class="text-center sortable" @click=${() => sortAgg('speaker_accuracy')} style="width: 100px;">Spkr (25) ${getAggSortIcon('speaker_accuracy')}</th>
                            <th class="text-center sortable" @click=${() => sortAgg('capitalization_accuracy')} style="width: 100px;">Caps (15) ${getAggSortIcon('capitalization_accuracy')}</th>
                            <th class="text-center sortable" @click=${() => sortAgg('panel_alignment')} style="width: 100px;">Panel (10) ${getAggSortIcon('panel_alignment')}</th>
                            <th class="text-center sortable pe-4" @click=${() => sortAgg('hallucination_penalty')} style="width: 100px;">Halluc (10) ${getAggSortIcon('hallucination_penalty')}</th>
                        </tr>
                    </thead>
                    <tbody class="border-top-0">
                        ${aggregatedData.map((m, i) => html`
                            <tr class="${i === 0 && aggSortState.col === 'score' && !aggSortState.asc ? 'bg-body-tertiary' : ''}">
                                <td class="ps-4 fw-medium text-body-emphasis">
                                    ${m.name}
                                </td>
                                <td class="text-center p-0 border-start border-end" style="width: 100px;">
                                    <div class="score-badge ${getScoreClass(m.score)}">${m.score}%</div>
                                </td>
                                <td class="text-center p-0 border-end" style="width: 100px;">
                                    <div class="score-badge ${getCompScoreClass(m.text_accuracy, 40)}">${m.text_accuracy}</div>
                                </td>
                                <td class="text-center p-0 border-end" style="width: 100px;">
                                    <div class="score-badge ${getCompScoreClass(m.speaker_accuracy, 25)}">${m.speaker_accuracy}</div>
                                </td>
                                <td class="text-center p-0 border-end" style="width: 100px;">
                                    <div class="score-badge ${getCompScoreClass(m.capitalization_accuracy, 15)}">${m.capitalization_accuracy}</div>
                                </td>
                                <td class="text-center p-0 border-end" style="width: 100px;">
                                    <div class="score-badge ${getCompScoreClass(m.panel_alignment, 10)}">${m.panel_alignment}</div>
                                </td>
                                <td class="text-center p-0" style="width: 100px;">
                                    <div class="score-badge ${getCompScoreClass(m.hallucination_penalty, 10)}">${(10 - m.hallucination_penalty).toFixed(1)}</div>
                                </td>
                            </tr>
                        `)}
                    </tbody>
                </table>
            </div>
        </div>
    `, $("#toptable"));
}