import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const AWS_REGION = process.env.AWS_REGION || "us-east-1";
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME || "";
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || "";
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || "";

const s3Client = new S3Client({
  region: AWS_REGION,
  credentials: {
    accessKeyId: AWS_ACCESS_KEY_ID,
    secretAccessKey: AWS_SECRET_ACCESS_KEY,
  },
});

async function testS3Connection() {
  console.log("\n=== Testing S3 Connection ===");
  console.log(`Region: ${AWS_REGION}`);
  console.log(`Bucket: ${S3_BUCKET_NAME}`);
  
  try {
    // Test creating a presigned URL
    const testKey = `test/connection-test-${Date.now()}.txt`;
    const command = new PutObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: testKey,
      ContentType: "text/plain",
    });
    
    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 60 });
    console.log("✓ Successfully generated presigned URL");
    console.log(`  URL length: ${presignedUrl.length} characters`);
    
    // Test uploading directly to S3
    const uploadCommand = new PutObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: testKey,
      Body: "Test content for S3 integration",
      ContentType: "text/plain",
    });
    
    await s3Client.send(uploadCommand);
    console.log("✓ Successfully uploaded test file to S3");
    
    // Test downloading from S3
    const getCommand = new GetObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: testKey,
    });
    
    const response = await s3Client.send(getCommand);
    const content = await response.Body?.transformToString();
    console.log("✓ Successfully downloaded test file from S3");
    console.log(`  Content: ${content}`);
    
    // Test deleting from S3
    const deleteCommand = new DeleteObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: testKey,
    });
    
    await s3Client.send(deleteCommand);
    console.log("✓ Successfully deleted test file from S3");
    
    return true;
  } catch (error) {
    console.error("✗ S3 connection test failed:", error);
    return false;
  }
}

async function testPresignedUrlEndpoint() {
  console.log("\n=== Testing Presigned URL API Endpoint ===");
  
  try {
    const response = await fetch("http://localhost:5000/api/s3/presigned-url", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cookie": "connect.sid=test-session", // You'll need a real session
      },
      body: JSON.stringify({
        fileName: "test-document.pdf",
        fileType: "application/pdf",
        category: "help-docs",
      }),
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log("✓ Presigned URL endpoint working");
      console.log(`  Upload URL received: ${data.uploadUrl ? 'Yes' : 'No'}`);
      console.log(`  File URL received: ${data.fileUrl ? 'Yes' : 'No'}`);
      console.log(`  S3 Key: ${data.s3Key}`);
      return data;
    } else {
      const error = await response.text();
      console.error(`✗ Presigned URL endpoint failed: ${response.status} - ${error}`);
      return null;
    }
  } catch (error) {
    console.error("✗ Presigned URL endpoint test failed:", error);
    return null;
  }
}

async function main() {
  console.log("Starting S3 Integration Tests...\n");
  
  // Check environment variables
  if (!S3_BUCKET_NAME || !AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
    console.error("✗ Missing required environment variables:");
    if (!S3_BUCKET_NAME) console.error("  - S3_BUCKET_NAME");
    if (!AWS_ACCESS_KEY_ID) console.error("  - AWS_ACCESS_KEY_ID");
    if (!AWS_SECRET_ACCESS_KEY) console.error("  - AWS_SECRET_ACCESS_KEY");
    process.exit(1);
  }
  
  // Run tests
  const s3ConnectionOk = await testS3Connection();
  
  if (s3ConnectionOk) {
    console.log("\n✓ All S3 direct tests passed!");
  } else {
    console.log("\n✗ S3 direct tests failed");
    process.exit(1);
  }
  
  console.log("\n=== S3 Integration Test Summary ===");
  console.log("S3 connection and basic operations are working correctly.");
  console.log("\nNote: To test the full upload workflow, you need to:");
  console.log("1. Log in to the application as an admin");
  console.log("2. Navigate to Settings > Help Documents or Company Policies");
  console.log("3. Upload a test document");
  console.log("4. Verify the document appears in the list");
  console.log("5. Download the document to verify S3 retrieval");
  console.log("6. Delete the document to verify S3 cleanup");
}

main().catch(console.error);
