import fs from 'fs';
import path from 'path';

// Comprehensive Test Reporter for AI Helpdesk Testing
export class TestReporter {
  private reports: TestReport[] = [];
  private startTime: Date = new Date();

  constructor(private outputDir: string = './test-reports') {
    this.ensureOutputDir();
  }

  private ensureOutputDir(): void {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  // Add test results
  addTestResult(testResult: TestResult): void {
    const report = this.findOrCreateReport(testResult.suite);
    report.results.push(testResult);
    report.endTime = new Date();
    
    this.updateSummary(report, testResult);
  }

  // Find or create test report for suite
  private findOrCreateReport(suiteName: string): TestReport {
    let report = this.reports.find(r => r.suiteName === suiteName);
    
    if (!report) {
      report = {
        suiteName,
        startTime: new Date(),
        endTime: new Date(),
        results: [],
        summary: {
          total: 0,
          passed: 0,
          failed: 0,
          skipped: 0,
          duration: 0
        },
        metrics: {}
      };
      this.reports.push(report);
    }
    
    return report;
  }

  // Update test summary
  private updateSummary(report: TestReport, result: TestResult): void {
    report.summary.total++;
    
    switch (result.status) {
      case 'passed':
        report.summary.passed++;
        break;
      case 'failed':
        report.summary.failed++;
        break;
      case 'skipped':
        report.summary.skipped++;
        break;
    }
    
    report.summary.duration = report.endTime.getTime() - report.startTime.getTime();
  }

  // Add performance metrics
  addMetrics(suiteName: string, metrics: PerformanceMetrics): void {
    const report = this.findOrCreateReport(suiteName);
    report.metrics = { ...report.metrics, ...metrics };
  }

  // Generate HTML report
  generateHTMLReport(): string {
    const reportPath = path.join(this.outputDir, `test-report-${Date.now()}.html`);
    const html = this.buildHTMLReport();
    
    fs.writeFileSync(reportPath, html);
    console.log(`Test report generated: ${reportPath}`);
    
    return reportPath;
  }

  // Generate JSON report
  generateJSONReport(): string {
    const reportPath = path.join(this.outputDir, `test-report-${Date.now()}.json`);
    const jsonReport = {
      timestamp: new Date().toISOString(),
      overallSummary: this.getOverallSummary(),
      reports: this.reports
    };
    
    fs.writeFileSync(reportPath, JSON.stringify(jsonReport, null, 2));
    console.log(`JSON report generated: ${reportPath}`);
    
    return reportPath;
  }

  // Generate console summary
  printSummary(): void {
    const summary = this.getOverallSummary();
    
    console.log('\n=== AI Helpdesk Test Summary ===');
    console.log(`Total Tests: ${summary.total}`);
    console.log(`Passed: ${summary.passed} (${((summary.passed / summary.total) * 100).toFixed(1)}%)`);
    console.log(`Failed: ${summary.failed} (${((summary.failed / summary.total) * 100).toFixed(1)}%)`);
    console.log(`Skipped: ${summary.skipped} (${((summary.skipped / summary.total) * 100).toFixed(1)}%)`);
    console.log(`Duration: ${(summary.duration / 1000).toFixed(2)}s`);
    
    console.log('\n=== Test Suite Results ===');
    this.reports.forEach(report => {
      const passRate = report.summary.total > 0 ? 
        ((report.summary.passed / report.summary.total) * 100).toFixed(1) : '0.0';
      
      console.log(`${report.suiteName}: ${report.summary.passed}/${report.summary.total} (${passRate}%) - ${(report.summary.duration / 1000).toFixed(2)}s`);
      
      if (report.summary.failed > 0) {
        const failedTests = report.results.filter(r => r.status === 'failed');
        failedTests.forEach(test => {
          console.log(`  ❌ ${test.testName}: ${test.error}`);
        });
      }
    });
    
    console.log('\n=== Performance Metrics ===');
    this.reports.forEach(report => {
      if (Object.keys(report.metrics).length > 0) {
        console.log(`${report.suiteName}:`);
        Object.entries(report.metrics).forEach(([key, value]) => {
          console.log(`  ${key}: ${value}`);
        });
      }
    });
  }

  // Get overall summary
  private getOverallSummary(): TestSummary {
    return this.reports.reduce((acc, report) => ({
      total: acc.total + report.summary.total,
      passed: acc.passed + report.summary.passed,
      failed: acc.failed + report.summary.failed,
      skipped: acc.skipped + report.summary.skipped,
      duration: acc.duration + report.summary.duration
    }), { total: 0, passed: 0, failed: 0, skipped: 0, duration: 0 });
  }

  // Build HTML report
  private buildHTMLReport(): string {
    const summary = this.getOverallSummary();
    const passRate = summary.total > 0 ? ((summary.passed / summary.total) * 100).toFixed(1) : '0.0';
    
    return `
<!DOCTYPE html>
<html>
<head>
    <title>AI Helpdesk Test Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background-color: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; }
        .header { text-align: center; border-bottom: 2px solid #007acc; padding-bottom: 20px; margin-bottom: 30px; }
        .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
        .summary-card { background: #f8f9fa; padding: 20px; border-radius: 8px; text-align: center; border-left: 4px solid #007acc; }
        .summary-card.passed { border-left-color: #28a745; }
        .summary-card.failed { border-left-color: #dc3545; }
        .summary-card h3 { margin: 0 0 10px 0; color: #333; }
        .summary-card .value { font-size: 24px; font-weight: bold; color: #007acc; }
        .summary-card.passed .value { color: #28a745; }
        .summary-card.failed .value { color: #dc3545; }
        .suite { margin-bottom: 30px; border: 1px solid #ddd; border-radius: 8px; overflow: hidden; }
        .suite-header { background: #007acc; color: white; padding: 15px; }
        .suite-content { padding: 20px; }
        .test-result { padding: 10px; margin: 5px 0; border-radius: 4px; }
        .test-result.passed { background: #d4edda; border-left: 4px solid #28a745; }
        .test-result.failed { background: #f8d7da; border-left: 4px solid #dc3545; }
        .test-result.skipped { background: #fff3cd; border-left: 4px solid #ffc107; }
        .metrics { background: #f8f9fa; padding: 15px; border-radius: 4px; margin-top: 15px; }
        .metrics h4 { margin: 0 0 10px 0; }
        .error-details { background: #fff; padding: 10px; margin-top: 10px; border-radius: 4px; font-family: monospace; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🤖 AI Helpdesk Test Report</h1>
            <p>Generated on ${new Date().toLocaleString()}</p>
        </div>
        
        <div class="summary">
            <div class="summary-card">
                <h3>Total Tests</h3>
                <div class="value">${summary.total}</div>
            </div>
            <div class="summary-card passed">
                <h3>Passed</h3>
                <div class="value">${summary.passed}</div>
                <div>${passRate}%</div>
            </div>
            <div class="summary-card failed">
                <h3>Failed</h3>
                <div class="value">${summary.failed}</div>
                <div>${summary.total > 0 ? ((summary.failed / summary.total) * 100).toFixed(1) : '0.0'}%</div>
            </div>
            <div class="summary-card">
                <h3>Duration</h3>
                <div class="value">${(summary.duration / 1000).toFixed(1)}s</div>
            </div>
        </div>
        
        ${this.reports.map(report => `
            <div class="suite">
                <div class="suite-header">
                    <h2>${report.suiteName}</h2>
                    <p>${report.summary.passed}/${report.summary.total} tests passed (${((report.summary.passed / report.summary.total) * 100).toFixed(1)}%) - ${(report.summary.duration / 1000).toFixed(2)}s</p>
                </div>
                <div class="suite-content">
                    ${report.results.map(result => `
                        <div class="test-result ${result.status}">
                            <strong>${result.testName}</strong>
                            <span style="float: right;">${result.duration}ms</span>
                            ${result.error ? `<div class="error-details">${result.error}</div>` : ''}
                        </div>
                    `).join('')}
                    
                    ${Object.keys(report.metrics).length > 0 ? `
                        <div class="metrics">
                            <h4>Performance Metrics</h4>
                            ${Object.entries(report.metrics).map(([key, value]) => `
                                <div><strong>${key}:</strong> ${value}</div>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>
            </div>
        `).join('')}
    </div>
</body>
</html>`;
  }

  // Generate AI quality report
  generateAIQualityReport(aiMetrics: AIQualityMetrics): string {
    const reportPath = path.join(this.outputDir, `ai-quality-report-${Date.now()}.json`);
    
    const qualityReport = {
      timestamp: new Date().toISOString(),
      confidence: {
        average: aiMetrics.averageConfidence,
        distribution: aiMetrics.confidenceDistribution,
        threshold: aiMetrics.confidenceThreshold
      },
      accuracy: {
        rate: aiMetrics.accuracyRate,
        byCategory: aiMetrics.accuracyByCategory
      },
      escalation: {
        rate: aiMetrics.escalationRate,
        correctEscalations: aiMetrics.correctEscalations
      },
      knowledge: {
        utilizationRate: aiMetrics.knowledgeBaseUtilization,
        newArticlesGenerated: aiMetrics.newArticlesGenerated,
        articleQuality: aiMetrics.averageArticleQuality
      },
      performance: {
        averageResponseTime: aiMetrics.averageResponseTime,
        throughput: aiMetrics.throughput,
        errorRate: aiMetrics.errorRate
      }
    };
    
    fs.writeFileSync(reportPath, JSON.stringify(qualityReport, null, 2));
    console.log(`AI Quality report generated: ${reportPath}`);
    
    return reportPath;
  }
}

// Type definitions
export interface TestResult {
  testName: string;
  suiteName: string;
  status: 'passed' | 'failed' | 'skipped';
  duration: number;
  error?: string;
  metadata?: any;
}

export interface TestReport {
  suiteName: string;
  startTime: Date;
  endTime: Date;
  results: TestResult[];
  summary: TestSummary;
  metrics: PerformanceMetrics;
}

export interface TestSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
}

export interface PerformanceMetrics {
  [key: string]: any;
  averageResponseTime?: number;
  throughput?: number;
  memoryUsage?: number;
  cpuUsage?: number;
  errorRate?: number;
}

export interface AIQualityMetrics {
  averageConfidence: number;
  confidenceDistribution: { [range: string]: number };
  confidenceThreshold: number;
  accuracyRate: number;
  accuracyByCategory: { [category: string]: number };
  escalationRate: number;
  correctEscalations: number;
  knowledgeBaseUtilization: number;
  newArticlesGenerated: number;
  averageArticleQuality: number;
  averageResponseTime: number;
  throughput: number;
  errorRate: number;
}

// Export singleton instance
export const testReporter = new TestReporter();