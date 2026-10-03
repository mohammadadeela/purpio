import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../lib/env.js";
const s3 = new S3Client({ region: "auto", endpoint: env.S3_ENDPOINT, credentials: env.S3_ACCESS_KEY_ID ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY! } : undefined, forcePathStyle: true });
export async function putObject(key: string, body: Buffer | string, contentType: string, cacheImmutable = true) {
  await s3.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: body, ContentType: contentType, CacheControl: cacheImmutable ? "public, max-age=31536000, immutable" : "no-cache" }));
  return env.CDN_URL ? `${env.CDN_URL}/${key}` : await getSignedUrl(s3, new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }), { expiresIn: 7 * 86400 });
}
