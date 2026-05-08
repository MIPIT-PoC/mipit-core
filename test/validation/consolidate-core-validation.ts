import fs from 'node:fs/promises';
import path from 'node:path';

type CheckStatus = 'passed' | 'failed' | 'warning' | 'skipped';

type CheckResult = {
  id: string;
  category: string;
  title: string;
  critical: boolean;
  status: CheckStatus;
  duration_ms: number;
  evidence?: Record<string, unknown>;
  error?: string;
};

type ValidationReport = {
  generated_at: string;
  mode: string;
  target: {
    protocol: string;
    host: string;
    port: number;
    base_url: string;
  };
  summary: {
    total: number;
    passed: number;
    failed: number;
    warnings: number;
    skipped: number;
    critical_failures: number;
  };
  checks: CheckResult[];
};

const resultsDir = path.join(__dirname, 'results');

async function discoverJsonReports(cliArgs: string[]) {
  if (cliArgs.length > 0) {
    return cliArgs.map((item) => path.resolve(process.cwd(), item));
  }

  const entries = await fs.readdir(resultsDir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(resultsDir, entry.name))
    .sort();
}

function buildMarkdown(reports: Array<{ file: string; report: ValidationReport }>) {
  const lines: string[] = [];
  const totals = reports.reduce(
    (acc, item) => {
      acc.total += item.report.summary.total;
      acc.passed += item.report.summary.passed;
      acc.failed += item.report.summary.failed;
      acc.warnings += item.report.summary.warnings;
      acc.skipped += item.report.summary.skipped;
      acc.critical_failures += item.report.summary.critical_failures;
      return acc;
    },
    { total: 0, passed: 0, failed: 0, warnings: 0, skipped: 0, critical_failures: 0 },
  );

  lines.push('# Consolidated Core Validation Report');
  lines.push('');
  lines.push(`- Generated at: ${new Date().toISOString()}`);
  lines.push(`- Reports included: ${reports.length}`);
  lines.push('');
  lines.push('## Global Summary');
  lines.push('');
  lines.push(`- Total checks: ${totals.total}`);
  lines.push(`- Passed: ${totals.passed}`);
  lines.push(`- Failed: ${totals.failed}`);
  lines.push(`- Warnings: ${totals.warnings}`);
  lines.push(`- Skipped: ${totals.skipped}`);
  lines.push(`- Critical failures: ${totals.critical_failures}`);
  lines.push('');
  lines.push('## Report Summary');
  lines.push('');
  lines.push('| File | Target | Generated | Passed | Failed | Warnings | Skipped | Critical failures |');
  lines.push('|---|---|---|---:|---:|---:|---:|---:|');

  for (const item of reports) {
    lines.push(
      `| ${path.basename(item.file)} | ${item.report.target.base_url} | ${item.report.generated_at} | ${item.report.summary.passed} | ${item.report.summary.failed} | ${item.report.summary.warnings} | ${item.report.summary.skipped} | ${item.report.summary.critical_failures} |`,
    );
  }

  lines.push('');
  lines.push('## Findings By Report');
  lines.push('');

  for (const item of reports) {
    lines.push(`### ${path.basename(item.file)}`);
    lines.push('');
    lines.push(`- Target: ${item.report.target.base_url}`);
    lines.push(`- Mode: ${item.report.mode}`);
    lines.push(`- Generated at: ${item.report.generated_at}`);

    const issues = item.report.checks.filter((check) => check.status === 'failed' || check.status === 'warning');
    if (issues.length === 0) {
      lines.push('- Result: all checks passed without warnings.');
      lines.push('');
      continue;
    }

    lines.push('- Findings:');
    lines.push('');
    lines.push('| ID | Status | Critical | Title | Error |');
    lines.push('|---|---|---|---|---|');
    for (const check of issues) {
      lines.push(
        `| ${check.id} | ${check.status.toUpperCase()} | ${check.critical ? 'yes' : 'no'} | ${check.title} | ${check.error ?? ''} |`,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function main() {
  const files = await discoverJsonReports(process.argv.slice(2));

  if (files.length === 0) {
    throw new Error('No se encontraron reportes JSON para consolidar');
  }

  const reports: Array<{ file: string; report: ValidationReport }> = [];
  for (const file of files) {
    const raw = await fs.readFile(file, 'utf8');
    reports.push({
      file,
      report: JSON.parse(raw) as ValidationReport,
    });
  }

  await fs.mkdir(resultsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(resultsDir, `core-validation-consolidated-${stamp}.md`);
  await fs.writeFile(outputPath, buildMarkdown(reports), 'utf8');

  console.log(`Consolidated Markdown report: ${outputPath}`);
}

main().catch((error) => {
  console.error('Core validation consolidation failed:', error);
  process.exitCode = 1;
});
