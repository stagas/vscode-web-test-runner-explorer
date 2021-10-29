import * as vscode from "vscode";
import {
  RetireEvent,
  TestAdapter,
  TestLoadStartedEvent,
  TestLoadFinishedEvent,
  TestRunStartedEvent,
  TestRunFinishedEvent,
  TestSuiteInfo,
  TestSuiteEvent,
  TestEvent,
} from "vscode-test-adapter-api";
import { Log } from "vscode-test-adapter-util";
import { startWebTestRunner } from "./commands";

/**
 * This class is intended as a starting point for implementing a "real" TestAdapter.
 * The file `README.md` contains further instructions.
 */
export class ExampleAdapter implements TestAdapter {
  private disposables: { dispose(): void }[] = [];

  private readonly testsEmitter = new vscode.EventEmitter<
    TestLoadStartedEvent | TestLoadFinishedEvent
  >();
  private readonly testStatesEmitter = new vscode.EventEmitter<
    TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent
  >();
  private readonly retireEmitter = new vscode.EventEmitter<RetireEvent>();
  // private readonly autorunEmitter = new vscode.EventEmitter<void>();

  get tests(): vscode.Event<TestLoadStartedEvent | TestLoadFinishedEvent> {
    return this.testsEmitter.event;
  }
  get testStates(): vscode.Event<
    TestRunStartedEvent | TestRunFinishedEvent | TestSuiteEvent | TestEvent
  > {
    return this.testStatesEmitter.event;
  }
  get retire(): vscode.Event<RetireEvent> {
    return this.retireEmitter.event;
  }

  constructor(
    public readonly workspace: vscode.WorkspaceFolder,
    private readonly log: Log
  ) {
    this.log.info("Initializing WebTestRunner adapter");

    this.disposables.push(this.testsEmitter);
    this.disposables.push(this.testStatesEmitter);
    this.disposables.push(this.retireEmitter);

    const writeEmitter = new vscode.EventEmitter<string>();
    const pty: vscode.Pseudoterminal = {
      onDidWrite: writeEmitter.event,
      open: () => {},
      close: () => {},
    };

    // let web-test-runner think it's a regular terminal
    // this allows for watch: true to work
    process.stdout.isTTY = true;
    process.stdout.write = (chunk): any => {
      writeEmitter.fire(chunk.toString().replaceAll("\n", "\r\n"));
    };

    const terminal = vscode.window.createTerminal({
      name: "WebTestRunner",
      pty,
    });

    // terminal.show();
  }

  // TODO: not 'any'
  private webTestRunner: any;

  async load(): Promise<void> {
    this.log.info("Loading WebTestRunner tests");

    if (this.webTestRunner) {
      this.disposables.push(this.webTestRunner);
      await this.webTestRunner.stop();
    }

    this.webTestRunner = await startWebTestRunner({
      onTestLoadStart: () => {
        this.testsEmitter.fire(<TestLoadStartedEvent>{ type: "started" });
      },

      onTestRunStart: () => {
        // retire all?
        this.testStatesEmitter.fire(<TestRunStartedEvent>{
          type: "started",
          tests: [],
        });
      },

      onTestSuiteInfo: (suite: TestSuiteInfo) => {
        this.testsEmitter.fire(<TestLoadFinishedEvent>{
          type: "finished",
          suite,
        });

        this.retireAllTests();
      },

      onTestEvents: (events: TestEvent[]) => {
        events.forEach((event) => this.testStatesEmitter.fire(event));
        this.testStatesEmitter.fire(<TestRunFinishedEvent>{ type: "finished" });
      },
    });
  }

  async run(tests: string[]): Promise<void> {
    this.log.info(`Running example tests ${JSON.stringify(tests)}`);

    this.webTestRunner.run();
  }

  /*	implement this method if your TestAdapter supports debugging tests
	async debug(tests: string[]): Promise<void> {
		// start a test run in a child process and attach the debugger to it...
	}
	*/

  /**
   * Invalidates all the tests for the given files.  This works because the file paths are used ids for the tests suites.
   * @param testFiles The files to invalidate the results for.
   */
  // private retireTestFiles(testFiles: string[]) {
  //   this.retireEmitter.fire(<RetireEvent>{
  //     tests: testFiles,
  //   });
  // }

  /**
   * Marks all tests as retired.
   */
  private retireAllTests() {
    this.retireEmitter.fire(<RetireEvent>{});
  }

  cancel(): void {
    if (this.webTestRunner) {
      this.webTestRunner.stop();
    }
    // in a "real" TestAdapter this would kill the child process for the current test run (if there is any)
    // throw new Error("Method not implemented.");
  }

  dispose(): void {
    this.cancel();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
  }
}
