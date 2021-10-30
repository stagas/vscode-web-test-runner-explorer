import * as vscode from "vscode";

import { TestSuiteInfo, TestInfo, TestEvent } from "vscode-test-adapter-api";

import {
  defaultReporter,
  startTestRunner,
  TestSession,
  TestSuiteResult,
  TestResult,
} from "@web/test-runner";

interface WebTestRunnerResult {
  suite: TestSuiteInfo;
  events: TestEvent[];
}

const transformSession = (session: TestSession): TestSuiteInfo => {
  return {
    type: "suite",
    id: session.testFile,
    file: session.testFile,
    label: session.testFile.split("/").pop() || "",
    children: [
      ...(session.testResults?.suites.map(
        transformSuiteInfo(session.testFile)
      ) ?? []),
      ...(session.testResults?.tests.map(transformTestInfo(session.testFile)) ??
        []),
    ],
  };
};

const transformSuiteInfo =
  (testFile: string) =>
  (suite: TestSuiteResult): TestSuiteInfo => {
    return {
      type: "suite",
      id: testFile + suite.name,
      file: testFile,
      label: suite.name,
      children: [
        ...suite.suites.map(transformSuiteInfo(testFile)),
        ...suite.tests.map(transformTestInfo(testFile)),
      ],
    };
  };

const transformSuiteResult =
  (testFile: string) =>
  (suite: TestSuiteResult): TestEvent[] => {
    return [
      ...suite.suites.map(transformSuiteResult(testFile)).flat(),
      ...suite.tests.map(transformTestResult(testFile)),
    ];
  };

const transformTestInfo =
  (testFile: string) =>
  (test: TestResult): TestInfo => {
    return {
      type: "test",
      id: testFile + test.name,
      file: testFile,
      label: test.name,
    };
  };

const transformTestResult =
  (testFile: string) =>
  (test: TestResult): TestEvent => {
    return {
      type: "test",
      test: testFile + test.name,
      ...(!test.error
        ? {
            state: "passed",
            file: testFile,
          }
        : {
            state: "failed",
            message: test.error.message,
            tooltip: test.error.message,
            decorations: [
              {
                line:
                  // get the last line of the stack trace (test case file)
                  // and extract the line number to highlight in the editor
                  // TODO: we should decorate all stack trace lines
                  //  Update: ^ this isn't possible because only test files are
                  //  being registered with the test api
                  +(
                    ((test.error.stack ?? "").split("\n").pop() ?? "").split(
                      ":"
                    )[1] ?? "-1"
                  ) - 1, // 0-based
                message: test.error.message,
              },
            ],
          }),
    };
  };

export const startWebTestRunner = async ({
  onTestLoadStart,
  onTestRunStart,
  onTestSuiteInfo,
  onTestEvents,
}: {
  onTestLoadStart: () => void;
  onTestRunStart: () => void;
  onTestSuiteInfo: (suite: TestSuiteInfo) => void;
  onTestEvents: (events: TestEvent[]) => void;
}) => {
  process.chdir(getActiveWorkspaceFolder());
  const runner = await startTestRunner({
    autoExitProcess: false,
    config: {
      watch: true,
      reporters: [
        {
          start({ config, sessions, testFiles, browserNames, startTime }) {
            onTestLoadStart();
          },
          stop({ sessions, testCoverage, focusedTestFile }) {},
          onTestRunStarted() {
            onTestRunStart();
          },
          onTestRunFinished({ sessions }) {
            onTestSuiteInfo(<TestSuiteInfo>{
              type: "suite",
              id: "root",
              label: "WebTestRunner",
              children: sessions.map(transformSession),
            });

            onTestEvents(
              <TestEvent[]>sessions
                .map((session) =>
                  transformSuiteResult(session.testFile)(
                    session.testResults ??
                      ({
                        suites: [],
                        tests: [],
                      } as unknown as TestSuiteResult)
                  )
                )
                .flat()
            );
          },
        },
        defaultReporter({
          reportTestResults: true,
          reportTestProgress: true,
        }),
      ],
    },
  });

  if (runner) {
    return {
      run: () => {
        runner.runTests(runner.sessions.all());
      },
      stop: () =>
        new Promise((resolve) => {
          runner.on("stopped", resolve);
          runner.stop();
        }),
    };
  } else {
    return null;
  }
};

function getActiveWorkspaceFolder(): string {
  const uri = vscode.window.activeTextEditor?.document.uri;
  let fsPath = process.cwd();
  if (uri)
    fsPath = vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath ?? fsPath;
  return fsPath;
}
