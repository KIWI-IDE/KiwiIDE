import { CircleCheck, CircleX, Play, SkipForward } from "lucide-react";
import type { PanelWindowCommand, TestReport } from "../../types";
import { t } from "../../i18n";

/** JUnit results in a detached tool window; running is left to the workbench. */
export function PanelTestsView({
  reports,
  onRun,
}: {
  reports: TestReport[];
  onRun: (command: PanelWindowCommand) => void;
}) {
  if (!reports.length) {
    return <div className="empty-problems"><Play size={20} /><span>{t("Noch keine Testergebnisse.")}</span></div>;
  }
  return (
    <div className="tests-view">
      {reports.map((report) => (
        <div className="test-report" key={report.name}>
          <div className="test-report-header">
            <strong>{report.name}</strong>
            <span>{report.tests} Tests</span>
            {report.failures + report.errors > 0
              ? <span className="severity-error">{report.failures + report.errors} fehlgeschlagen</span>
              : <span className="severity-info">{t("bestanden")}</span>}
            <button title={t("Erneut ausführen")} onClick={() => onRun({ type: "runTest", report: report.name })}>
              <Play size={12} fill="currentColor" />
            </button>
          </div>
          {report.cases.map((testCase) => (
            <button
              className="test-case"
              key={`${testCase.className}.${testCase.name}`}
              onClick={() => onRun({ type: "runTest", report: report.name, testCase: `${testCase.className}.${testCase.name}` })}
            >
              {testCase.status === "passed"
                ? <CircleCheck size={13} className="severity-info" />
                : testCase.status === "skipped"
                  ? <SkipForward size={13} />
                  : <CircleX size={13} className="severity-error" />}
              <span>{testCase.name}</span>
              <small>{testCase.className}</small>
              {testCase.message && <span className="problem-message">{testCase.message}</span>}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
