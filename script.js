import * as d3 from "d3";
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
let fullData = null;
let comparisonData = null; // New state
let modalInstance = null;
let sortStates = {
    1: { col: 'id', width: 0, asc: true },
    2: { col: 'id', width: 0, asc: true }
};
let aggSortStates = {
    1: { col: 'score', asc: false },
    2: { col: 'score', asc: false }
};

// Initialize
(async function init() {
    try {
        const [res, resComp] = await Promise.all([
            fetch('data/dashboard_data.json'),
            fetch('data/comparison_results.json')
        ]);

        fullData = await res.json();
        comparisonData = await resComp.json();

        $("#loading").classList.add("d-none");

        // Render Evaluation Results (Dataset 2)
        renderAggregatedTable(fullData.dataset2, "#toptable2", 2);
        renderTable(fullData.dataset2, "#output2", 2);

        // Render Comparison Dashboard
        renderComparisonDashboard(comparisonData);

        // Initialize Modal
        modalInstance = new bootstrap.Modal(document.getElementById('detailModal'));

    } catch (e) {
        bootstrapAlert({ color: "danger", title: "Error loading data", body: "Could not load dashboard_data.json." });
        console.error(e);
    }
})();

function renderTable(dataset, selector, setId) {
    if (!dataset) return;
    const sortState = sortStates[setId];
    const models = dataset.all_models; // Already sorted in backend, but we might resort here

    // Sorting Logic associated with this specific table
    const sortedStrips = [...dataset.strips].sort((a, b) => {
        let valA, valB;

        if (sortState.col === 'id') {
            valA = a.id;
            valB = b.id;
        } else if (sortState.col === 'average') {
            valA = a.average;
            valB = b.average;
        } else {
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
                            <th class="ps-4 sortable" @click=${() => sortBy('id', setId)} style="width: 140px;">
                                Date / ID ${getSortIcon('id')}
                            </th>
                            ${models.map(m => html`
                                <th class="text-center sortable" @click=${() => sortBy(m, setId)} style="width: 100px;">
                                    ${m} ${getSortIcon(m)}
                                </th>
                            `)}
                            <th class="text-end pe-4 sortable" @click=${() => sortBy('average', setId)} style="width: 100px;">
                                Average ${getSortIcon('average')}
                            </th>
                        </tr>
                    </thead>
                    <tbody class="border-top-0">
                        ${sortedStrips.map(strip => html`
                            <tr class="cursor-pointer" @click=${() => openModal(strip.id, dataset)} style="cursor: pointer;">
                                <td class="ps-4 fw-medium text-primary">${strip.id}</td>
                                ${models.map(m => {
        const score = strip.models[m] ? strip.models[m].score : '-';
        const bgColor = getScoreColor(score);
        const textColor = getTextColor(score);
        return html`<td class="p-0 text-center border-start border-end" style="width: 100px;">
                                        <div class="score-badge" style="background-color: ${bgColor}; color: ${textColor}">${score}${score !== '-' ? '%' : ''}</div>
                                    </td>`;
    })}
                                <td class="p-0 text-center border-start bg-body-tertiary" style="width: 100px;">
                                    <div class="score-badge" style="background-color: ${getScoreColor(strip.average)}; color: ${getTextColor(strip.average)}">${strip.average}%</div>
                                </td>
                            </tr>
                        `)}
                    </tbody>
                    <tfoot class="fw-bold text-secondary border-top">
                        <tr>
                            <td class="ps-4">Model Average</td>
                            ${models.map(m => html`
                                <td class="p-0 text-center">
                                    <div class="score-badge" style="background-color: ${getScoreColor(dataset.model_stats[m])}; color: ${getTextColor(dataset.model_stats[m])}">${dataset.model_stats[m]}%</div>
                                </td>
                            `)}
                            <td></td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    `, $(selector));
}

function sortBy(col, setId) {
    const state = sortStates[setId];
    if (state.col === col) {
        state.asc = !state.asc;
    } else {
        state.col = col;
        state.asc = (col === 'id');
    }

    // Re-render only the affected table
    if (setId === 1) renderTable(fullData.dataset1, "#output1", 1);
    else renderTable(fullData.dataset2, "#output2", 2);
}

function renderAggregatedTable(dataset, selector, setId) {
    if (!dataset) return;
    const aggState = aggSortStates[setId];
    const models = dataset.all_models;
    const stats = {};

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

    dataset.strips.forEach(strip => {
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

    let aggregatedData = models.map(m => {
        const c = stats[m].count || 1;
        return {
            name: m,
            count: stats[m].count,
            score: parseFloat((stats[m].score / c).toFixed(1)),
            text_accuracy: parseFloat((stats[m].text_accuracy / c).toFixed(1)),
            speaker_accuracy: parseFloat((stats[m].speaker_accuracy / c).toFixed(1)),
            capitalization_accuracy: parseFloat((stats[m].capitalization_accuracy / c).toFixed(1)),
            panel_alignment: parseFloat((stats[m].panel_alignment / c).toFixed(1)),
            hallucination_penalty: parseFloat((stats[m].hallucination_penalty / c).toFixed(1))
        };
    });

    aggregatedData.sort((a, b) => {
        let valA = a[aggState.col];
        let valB = b[aggState.col];

        if (aggState.col === 'name') {
            if (valA < valB) return aggState.asc ? -1 : 1;
            if (valA > valB) return aggState.asc ? 1 : -1;
            return 0;
        }

        if (valA < valB) return aggState.asc ? -1 : 1;
        if (valA > valB) return aggState.asc ? 1 : -1;
        return 0;
    });

    const getAggSortIcon = (col) => {
        if (aggState.col !== col) return '';
        return aggState.asc ? html`<i class="bi bi-caret-up-fill sort-icon"></i>` : html`<i class="bi bi-caret-down-fill sort-icon"></i>`;
    };

    const sortAgg = (col) => {
        if (aggState.col === col) {
            aggState.asc = !aggState.asc;
        } else {
            aggState.col = col;
            aggState.asc = (col === 'name');
        }
        renderAggregatedTable(dataset, selector, setId);
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
                            <tr class="${i === 0 && aggState.col === 'score' && !aggState.asc ? 'bg-body-tertiary' : ''}">
                                <td class="ps-4 fw-medium text-body-emphasis">${m.name}</td>
                                <td class="text-center p-0 border-start border-end" style="width: 100px;">
                                    <div class="score-badge" style="background-color: ${getScoreColor(m.score)}; color: ${getTextColor(m.score)}">${m.score}%</div>
                                </td>
                                <td class="text-center p-0 border-end" style="width: 100px;">
                                    <div class="score-badge" style="background-color: ${getCompScoreColor(m.text_accuracy, 40)}; color: ${getCompTextColor(m.text_accuracy, 40)}">${m.text_accuracy}</div>
                                </td>
                                <td class="text-center p-0 border-end" style="width: 100px;">
                                    <div class="score-badge" style="background-color: ${getCompScoreColor(m.speaker_accuracy, 25)}; color: ${getCompTextColor(m.speaker_accuracy, 25)}">${m.speaker_accuracy}</div>
                                </td>
                                <td class="text-center p-0 border-end" style="width: 100px;">
                                    <div class="score-badge" style="background-color: ${getCompScoreColor(m.capitalization_accuracy, 15)}; color: ${getCompTextColor(m.capitalization_accuracy, 15)}">${m.capitalization_accuracy}</div>
                                </td>
                                <td class="text-center p-0 border-end" style="width: 100px;">
                                    <div class="score-badge" style="background-color: ${getCompScoreColor(m.panel_alignment, 10)}; color: ${getCompTextColor(m.panel_alignment, 10)}">${m.panel_alignment}</div>
                                </td>
                                <td class="text-center p-0" style="width: 100px;">
                                    <div class="score-badge" style="background-color: ${getCompScoreColor(m.hallucination_penalty, 10)}; color: ${getCompTextColor(m.hallucination_penalty, 10)}">${(10 - m.hallucination_penalty).toFixed(1)}</div>
                                </td>
                            </tr>
                        `)}
                    </tbody>
                </table>
            </div>
        </div>
    `, $(selector));
}

// D3 Color Scales
function getScoreColor(score) {
    if (score === '-' || score === null || score === undefined) return '#f8f9fa'; // bg-body-tertiary equivalent
    const val = parseFloat(score);
    // Map 50-100 mostly, as <50 is very bad. 
    // Usually interpolation should be linear 0-100?
    // Let's do strict 0-100 for continuous scale.
    // Using RdYlGn: Red (0) -> Yellow (0.5) -> Green (1.0)
    return d3.interpolateRdYlGn(val / 100);
}

function getTextColor(score) {
    if (score === '-' || score === null || score === undefined) return '#6c757d'; // text-muted
    const s = parseFloat(score);
    const color = d3.color(d3.interpolateRdYlGn(s / 100));
    // Check luminance. RdYlGn(0.5) is very light (Yellow). RdYlGn(0) is Dark Red. RdYlGn(1) is Dark Green.
    // Use Lab lightness:
    return d3.lab(color).l > 60 ? '#000' : '#fff';
}

function getCompScoreColor(val, max) {
    if (val === undefined || val === null) return '#f8f9fa';
    const pct = parseFloat(val) / max;
    return d3.interpolateRdYlGn(pct);
}

function getCompTextColor(val, max) {
    if (val === undefined || val === null) return '#6c757d';
    const pct = parseFloat(val) / max;
    const color = d3.color(d3.interpolateRdYlGn(pct));
    return d3.lab(color).l > 60 ? '#000' : '#fff';
}

function openModal(id, dataset) {
    const strip = dataset.strips.find(s => s.id === id);
    if (!strip) return;

    $("#detailModalLabel").textContent = `Analysis: ${id}`;

    const img = $("#modal-img");
    const loader = $("#img-loader");
    const viewImageBtn = $("#view-image-btn");

    img.classList.add('d-none');
    loader.classList.remove('d-none');
    viewImageBtn.classList.remove('d-none');
    viewImageBtn.href = strip.url;
    img.src = strip.url;

    img.onerror = () => {
        loader.classList.add('d-none');
        img.classList.add('d-none');
    };

    img.onload = () => {
        loader.classList.add('d-none');
        img.classList.remove('d-none');
    };

    render(html`
        <div class="card border-0 bg-body-tertiary rounded-3">
            <div class="card-header bg-transparent border-0 text-uppercase small text-body-secondary fw-bold pb-0">Section A — Ground Truth</div>
            <div class="card-body">
                <div class="font-monospace small">
                    ${renderTranscript(strip.ground_truth)}
                </div>
            </div>
        </div>

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
    return html`
        <tr>
            <td class="ps-3 fw-medium text-body-emphasis small">${m.name}</td>
            <td class="p-0 text-center border-start border-end" style="width: 100px;">
                <div class="score-badge" style="background-color: ${getScoreColor(m.score)}; color: ${getTextColor(m.score)}">${m.score}</div>
            </td>
            <td class="p-0 text-center border-end" style="width: 100px;">
                <div class="score-badge" style="background-color: ${getCompScoreColor(m.metrics.text_accuracy, 40)}; color: ${getCompTextColor(m.metrics.text_accuracy, 40)}">${m.metrics.text_accuracy}</div>
            </td>
            <td class="p-0 text-center border-end" style="width: 100px;">
                <div class="score-badge" style="background-color: ${getCompScoreColor(m.metrics.speaker_accuracy, 25)}; color: ${getCompTextColor(m.metrics.speaker_accuracy, 25)}">${m.metrics.speaker_accuracy}</div>
            </td>
            <td class="p-0 text-center border-end" style="width: 100px;">
                <div class="score-badge" style="background-color: ${getCompScoreColor(m.metrics.capitalization_accuracy, 15)}; color: ${getCompTextColor(m.metrics.capitalization_accuracy, 15)}">${m.metrics.capitalization_accuracy}</div>
            </td>
            <td class="p-0 text-center border-end" style="width: 100px;">
                <div class="score-badge" style="background-color: ${getCompScoreColor(m.metrics.panel_alignment, 10)}; color: ${getCompTextColor(m.metrics.panel_alignment, 10)}">${m.metrics.panel_alignment}</div>
            </td>
            <td class="p-0 text-center" style="width: 100px;">
                <div class="score-badge" style="background-color: ${getCompScoreColor(m.metrics.hallucination_penalty, 10)}; color: ${getCompTextColor(m.metrics.hallucination_penalty, 10)}">${(10 - parseFloat(m.metrics.hallucination_penalty)).toFixed(1)}</div>
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
    let parsedData = data;
    if (typeof data === 'string') {
        try { parsedData = JSON.parse(data); } catch (e) { }
    }

    let panels = null;
    if (parsedData) {
        if (Array.isArray(parsedData)) panels = parsedData;
        else if (Array.isArray(parsedData.panels)) panels = parsedData.panels;
    }

    if (panels && panels.length > 0) {
        return renderTranscript(panels);
    } else {
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

// ----------------------------------------------------
// COMPARISON DASHBOARD LOGIC
// ----------------------------------------------------

function renderComparisonDashboard(data) {
    if (!data) return;

    // Calculate Metrics
    const total = data.length;
    if (total === 0) return;

    const bothAgree = data.filter(d => d.comparison.speaker_agreement && d.comparison.text_agreement).length;
    const textAgree = data.filter(d => d.comparison.text_agreement).length;
    const speakerAgree = data.filter(d => d.comparison.speaker_agreement).length;

    // Derived stats
    const coveragePct = ((bothAgree / total) * 100).toFixed(1);
    const textAgreePct = ((textAgree / total) * 100).toFixed(1);
    const speakerAgreePct = ((speakerAgree / total) * 100).toFixed(1);

    // Render Stats Cards
    render(html`
        <!-- Coverage Card -->
        <div class="col-md-4">
            <div class="card h-100 border-0 shadow-sm bg-body-tertiary">
                <div class="card-body text-center p-4">
                    <h6 class="text-secondary text-uppercase fw-bold mb-3 small">Comparison Coverage</h6>
                    <div class="display-4 fw-bold text-primary mb-2">${coveragePct}%</div>
                    <p class="text-muted small mb-0">Panels where BOTH speaker and text agree completely.</p>
                </div>
            </div>
        </div>
        
        <!-- Text Agreement Card -->
        <div class="col-md-4">
            <div class="card h-100 border-0 shadow-sm">
                <div class="card-body text-center p-4">
                    <h6 class="text-secondary text-uppercase fw-bold mb-3 small">Text Agreement</h6>
                    <div class="display-4 fw-bold text-success mb-2">${textAgreePct}%</div>
                    <p class="text-muted small mb-0">Normalized text matches between models.</p>
                </div>
            </div>
        </div>

        <!-- Speaker Agreement Card -->
        <div class="col-md-4">
            <div class="card h-100 border-0 shadow-sm">
                <div class="card-body text-center p-4">
                    <h6 class="text-secondary text-uppercase fw-bold mb-3 small">Speaker Agreement</h6>
                    <div class="display-4 fw-bold text-info mb-2">${speakerAgreePct}%</div>
                    <p class="text-muted small mb-0">Speaker attribution matches.</p>
                </div>
            </div>
        </div>
    `, $("#comparison-stats"));


    // Render Agreement Bar
    // Categories: 
    // 1. Full Agreement (Both)
    // 2. Text Only (Text True, Spk False)
    // 3. Speaker Only (Spk True, Text False) - Rare but possible
    // 4. Disagreement (Both False) OR (Text False, Spk True/False) -> Basically !Text Agreement is the main disagreement usually.

    // Let's stick to prompt visual:
    // - Both Agree
    // - Text Agree, Speaker Disagree
    // - Text Disagree 

    const countBoth = bothAgree;
    const countTextOnly = data.filter(d => d.comparison.text_agreement && !d.comparison.speaker_agreement).length;
    const countDisagree = total - countBoth - countTextOnly; // Text Disagree

    const pctBoth = (countBoth / total) * 100;
    const pctTextOnly = (countTextOnly / total) * 100;
    const pctDisagree = (countDisagree / total) * 100;

    render(html`
        <div class="progress-bar bg-success" role="progressbar" style="width: ${pctBoth}%" title="Both Agree: ${countBoth}"></div>
        <div class="progress-bar bg-warning" role="progressbar" style="width: ${pctTextOnly}%" title="Text Only: ${countTextOnly}"></div>
        <div class="progress-bar bg-danger" role="progressbar" style="width: ${pctDisagree}%" title="Text Disagree: ${countDisagree}"></div>
    `, $("#agreement-bar"));

    render(html`
        <div><i class="bi bi-circle-fill text-success me-1"></i> Full Agreement (${countBoth})</div>
        <div><i class="bi bi-circle-fill text-warning me-1"></i> Text Agree, Speaker Disagree (${countTextOnly})</div>
        <div><i class="bi bi-circle-fill text-danger me-1"></i> Text Disagree (${countDisagree})</div>
    `, $("#agreement-legend"));


    // Render Table
    renderCompTable(data, $("#comparison-table"));
}

function renderCompTable(data, container) {
    // Pagination or virtual scroll? simple render for now as list is small (~130 items)

    render(html`
        <div class="card shadow-sm border-0 overflow-hidden">
             <div class="table-responsive">
                <table class="table table-hover mb-0 align-middle small">
                    <thead class="bg-body-tertiary text-secondary text-uppercase fw-bold">
                        <tr>
                            <th class="ps-4" style="width: 100px">ID</th>
                            <th style="width: 120px">Speaker (A)</th>
                            <th style="width: 120px">Speaker (B)</th>
                            <th>Dialogue (A)</th>
                            <th>Dialogue (B)</th>
                            <th class="text-center" style="width: 50px" title="Speaker Agreement">Spk</th>
                            <th class="text-center pe-4" style="width: 50px" title="Text Agreement">Txt</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.map(row => {
        const spkAgree = row.comparison.speaker_agreement;
        const txtAgree = row.comparison.text_agreement;
        const isFullAgree = spkAgree && txtAgree;

        // Highlight diffs in red
        const spkClass = spkAgree ? '' : 'text-danger fw-bold bg-danger-subtle';
        const txtClass = txtAgree ? '' : 'text-danger bg-danger-subtle';

        return html`
                                <tr class="${isFullAgree ? '' : ''}">
                                    <td class="ps-4 text-muted font-monospace">${row.comparison.panel_id}</td>
                                    
                                    <!-- Speaker A -->
                                    <td class="${spkAgree ? '' : 'bg-body-secondary'}">
                                        ${row.model_a_raw.speaker || html`<span class="text-muted fst-italic">None</span>`}
                                    </td>
                                    
                                    <!-- Speaker B -->
                                    <td class="${spkAgree ? '' : 'bg-warning-subtle'}">
                                        ${row.model_b_raw.speaker || html`<span class="text-muted fst-italic">None</span>`}
                                    </td>

                                    <!-- Text A -->
                                    <td class="${txtAgree ? '' : 'bg-body-secondary'}">
                                        "${row.model_a_raw.text}"
                                    </td>
                                    
                                    <!-- Text B -->
                                    <td class="${txtAgree ? '' : 'bg-warning-subtle'}">
                                        "${row.model_b_raw.text}"
                                    </td>

                                    <!-- Flags -->
                                    <td class="text-center">
                                        ${spkAgree
                ? html`<i class="bi bi-check-circle-fill text-success"></i>`
                : html`<i class="bi bi-x-circle-fill text-danger"></i>`}
                                    </td>
                                    <td class="text-center pe-4">
                                        ${txtAgree
                ? html`<i class="bi bi-check-circle-fill text-success"></i>`
                : html`<i class="bi bi-x-circle-fill text-danger"></i>`}
                                    </td>
                                </tr>
                            `;
    })}
                    </tbody>
                </table>
             </div>
        </div>
    `, container);
}