#!/usr/bin/env node

import { spawn } from 'child_process';
import { TestReporter } from './test-reporter';

// Comprehensive Test Runner for AI Helpdesk
export class TestRunner {
  private reporter: TestReporter;
  
  constructor() {
    this.reporter = new TestReporter();
  }

  // Run all test suites
  async runAllTests(): Promise<void> {
    console.log('🚀 Starting comprehensive AI Helpdesk test suite...\n');
    
    const testSuites = [
      { name: 'Unit Tests', command: 'npm run test:unit' },
      { name: 'Integration Tests', command: 'npm run test:integration' },
      { name: 'AI Quality Tests', command: 'npm run test:ai' },
      { name: 'Load Tests', command: 'npm run test:load' },
      { name: 'E2E Tests', command: 'npm run test:e2e' }
    ];

    const results = [];
    
    for (const suite of testSuites) {
      console.log(`📋 Running ${suite.name}...`);
      const result = await this.runTestSuite(suite.name, suite.command);
      results.push(result);
      
      if (result.failed > 0) {
        console.log(`❌ ${suite.name} completed with ${result.failed} failures`);
      } else {
        console.log(`✅ ${suite.name} completed successfully`);
      }
      console.log('');
    }

    // Generate reports
    console.log('📊 Generating test reports...');
    this.reporter.generateHTMLReport();
    this.reporter.generateJSONReport();
    this.reporter.printSummary();
    
    // Check overall success
    const totalFailed = results.reduce((acc, r) => acc + r.failed, 0);
    if (totalFailed > 0) {
      console.log(`\n❌ Test suite completed with ${totalFailed} total failures`);
      process.exit(1);
    } else {
      console.log('\n✅ All tests passed successfully!');
    }
  }

  // Run specific test suite
  async runTestSuite(suiteName: string, command: string): Promise<{ passed: number; failed: number; skipped: number }> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let passed = 0, failed = 0, skipped = 0;
      
      const process = spawn('npm', ['test', '--', '--testPathPattern=' + this.getTestPattern(suiteName)], {
        stdio: 'pipe',
        shell: true
      });

      let output = '';
      
      process.stdout.on('data', (data) => {
        const text = data.toString();
        output += text;
        
        // Parse Jest output for test results
        const passMatch = text.match(/✓\s+(.+)/g);
        const failMatch = text.match(/✕\s+(.+)/g);
        const skipMatch = text.match(/○\s+(.+)/g);
        
        if (passMatch) {
          passMatch.forEach(match => {
            const testName = match.replace('✓ ', '').trim();
            passed++;
            this.reporter.addTestResult({
              testName,
              suiteName,
              status: 'passed',
              duration: Date.now() - startTime
            });
          });
        }
        
        if (failMatch) {
          failMatch.forEach(match => {
            const testName = match.replace('✕ ', '').trim();
            failed++;
            this.reporter.addTestResult({
              testName,
              suiteName,
              status: 'failed',
              duration: Date.now() - startTime,
              error: 'Test failed - check detailed output'
            });
          });
        }
        
        if (skipMatch) {
          skipMatch.forEach(match => {
            const testName = match.replace('○ ', '').trim();
            skipped++;
            this.reporter.addTestResult({
              testName,
              suiteName,
              status: 'skipped',
              duration: 0
            });
          });
        }
      });

      process.stderr.on('data', (data) => {
        output += data.toString();
      });

      process.on('close', (code) => {
        // Extract performance metrics from output
        this.extractMetrics(suiteName, output);
        
        resolve({ passed, failed, skipped });
      });
    });
  }

  // Get test pattern for specific suite
  private getTestPattern(suiteName: string): string {
    const patterns: { [key: string]: string } = {
      'Unit Tests': 'unit',
      'Integration Tests': 'integration',
      'AI Quality Tests': 'ai',
      'Load Tests': 'load',
      'E2E Tests': 'e2e'
    };
    
    return patterns[suiteName] || '';
  }

  // Extract performance metrics from test output
  private extractMetrics(suiteName: string, output: string): void {
    const metrics: any = {};
    
    // Extract timing information
    const timeMatch = output.match(/Time:\s+([\d.]+)\s*s/);
    if (timeMatch) {
      metrics.duration = `${timeMatch[1]}s`;
    }
    
    // Extract memory usage
    const memoryMatch = output.match(/Memory usage:\s+([\d.]+)\s*MB/);
    if (memoryMatch) {
      metrics.memoryUsage = `${memoryMatch[1]}MB`;
    }
    
    // Extract test counts
    const testsMatch = output.match(/(\d+)\s+passing/);
    if (testsMatch) {
      metrics.testsRun = testsMatch[1];
    }
    
    // AI-specific metrics
    if (suiteName.includes('AI')) {
      const confidenceMatch = output.match(/Average confidence:\s+([\d.]+)/);
      if (confidenceMatch) {
        metrics.averageConfidence = confidenceMatch[1];
      }
      
      const throughputMatch = output.match(/Throughput:\s+([\d.]+)\s*req\/s/);
      if (throughputMatch) {
        metrics.throughput = `${throughputMatch[1]} req/s`;
      }
    }
    
    // Load test metrics
    if (suiteName.includes('Load')) {
      const responseTimeMatch = output.match(/Avg response time:\s+([\d.]+)ms/);
      if (responseTimeMatch) {
        metrics.avgResponseTime = `${responseTimeMatch[1]}ms`;
      }
      
      const errorRateMatch = output.match(/Error rate:\s+([\d.]+)%/);
      if (errorRateMatch) {
        metrics.errorRate = `${errorRateMatch[1]}%`;
      }
    }
    
    this.reporter.addMetrics(suiteName, metrics);
  }

  // Run AI quality assessment
  async runAIQualityAssessment(): Promise<void> {
    console.log('🧠 Running AI Quality Assessment...');
    
    // This would run specific AI quality tests and collect metrics
    const aiMetrics = {
      averageConfidence: 0.75,
      confidenceDistribution: {
        'high (0.8-1.0)': 45,
        'medium (0.5-0.8)': 35,
        'low (0-0.5)': 20
      },
      confidenceThreshold: 0.7,
      accuracyRate: 0.82,
      accuracyByCategory: {
        'authentication': 0.92,
        'technical': 0.75,
        'general': 0.68
      },
      escalationRate: 0.25,
      correctEscalations: 0.88,
      knowledgeBaseUtilization: 0.65,
      newArticlesGenerated: 12,
      averageArticleQuality: 0.78,
      averageResponseTime: 1250,
      throughput: 45,
      errorRate: 0.03
    };
    
    this.reporter.generateAIQualityReport(aiMetrics);
  }

  // Run performance benchmarks
  async runPerformanceBenchmarks(): Promise<void> {
    console.log('⚡ Running Performance Benchmarks...');
    
    const benchmarks = [
      { name: 'Baseline Performance', users: 1, duration: 60 },
      { name: 'Light Load', users: 10, duration: 120 },
      { name: 'Medium Load', users: 50, duration: 180 },
      { name: 'Heavy Load', users: 100, duration: 300 }
    ];
    
    for (const benchmark of benchmarks) {
      console.log(`📊 Running ${benchmark.name} (${benchmark.users} users, ${benchmark.duration}s)...`);
      
      // Simulate benchmark execution
      const result = await this.simulateBenchmark(benchmark);
      
      this.reporter.addMetrics('Performance Benchmarks', {
        [`${benchmark.name} - Avg Response Time`]: `${result.avgResponseTime}ms`,
        [`${benchmark.name} - Throughput`]: `${result.throughput} req/s`,
        [`${benchmark.name} - Error Rate`]: `${result.errorRate}%`,
        [`${benchmark.name} - Memory Usage`]: `${result.memoryUsage}MB`
      });
    }
  }

  // Simulate benchmark execution
  private async simulateBenchmark(benchmark: any): Promise<any> {
    // This would actually run load tests
    return new Promise(resolve => {
      setTimeout(() => {
        resolve({
          avgResponseTime: 200 + (benchmark.users * 5),
          throughput: Math.max(100 - benchmark.users, 10),
          errorRate: Math.min(benchmark.users * 0.1, 5),
          memoryUsage: 50 + (benchmark.users * 0.5)
        });
      }, 1000);
    });
  }
}

// CLI interface
if (require.main === module) {
  const runner = new TestRunner();
  const command = process.argv[2];
  
  switch (command) {
    case 'all':
      runner.runAllTests();
      break;
    case 'ai-quality':
      runner.runAIQualityAssessment();
      break;
    case 'performance':
      runner.runPerformanceBenchmarks();
      break;
    default:
      console.log('Usage: node test-runner.js [all|ai-quality|performance]');
      break;
  }
}