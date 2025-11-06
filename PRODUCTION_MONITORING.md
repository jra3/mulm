# Production Upload Monitoring Guide

## Pre-Deployment Checklist

Before deploying the new upload limits to production:

- [x] Local stress test passed (22/22 tests)
- [x] CI tests passing
- [ ] Deploy to production
- [ ] Update nginx config with new limits
- [ ] Test with real device
- [ ] Monitor for 24-48 hours

## Deployment Steps

### 1. Deploy Application

```bash
ssh BAP "cd /opt/basny && git pull && sudo docker-compose -f docker-compose.prod.yml pull && sudo docker-compose -f docker-compose.prod.yml up -d"
```

### 2. Update Nginx Config

```bash
# Copy new nginx config
scp nginx/conf.d/default.conf BAP:/tmp/

# Apply and reload
ssh BAP "sudo cp /tmp/default.conf /opt/basny/nginx/conf.d/ && sudo docker exec basny-nginx nginx -t && sudo docker exec basny-nginx nginx -s reload"
```

### 3. Verify Deployment

```bash
# Check app is running
ssh BAP "sudo docker ps | grep basny-app"

# Check app logs
ssh BAP "sudo docker logs basny-app --tail 50"

# Check nginx config
ssh BAP "sudo docker exec basny-nginx nginx -t"
```

## Real-World Testing

### Test with Actual iPhone

1. Take a photo with your iPhone 17
2. Go to https://bap.basny.org/submission/new
3. Upload the photo
4. Monitor the upload process

**Expected behavior:**
- Upload completes successfully
- No error messages
- Image displays correctly after processing

### Monitor Upload Process

```bash
# Watch app logs in real-time
ssh BAP "sudo docker logs basny-app -f | grep -i 'image\|upload\|process'"
```

Look for log messages like:
```
[INFO] Processed image in XXXms { originalSize: XXXXX, processedSize: XXXXX, format: 'jpeg' }
[INFO] Image uploaded successfully { memberId: X, submissionId: X, key: '...', size: XXXXX }
```

## Performance Monitoring

### CPU and Memory Usage

```bash
# Check container resource usage
ssh BAP "sudo docker stats basny-app --no-stream"
```

**What to watch:**
- **CPU %** - Should spike briefly during uploads, then drop
- **MEM USAGE** - Should stay under 1GB normally
- **MEM %** - Watch for sustained high usage (>70%)

### Application Logs

```bash
# Watch for errors
ssh BAP "sudo docker logs basny-app -f --tail 100 | grep -i error"

# Watch image processing
ssh BAP "sudo docker logs basny-app -f --tail 100 | grep 'Processed image'"

# Watch upload completions
ssh BAP "sudo docker logs basny-app -f --tail 100 | grep 'Image uploaded successfully'"
```

### Nginx Access Logs

```bash
# Monitor upload endpoints
ssh BAP "tail -f /mnt/basny-data/nginx/logs/access.log | grep -E 'POST.*/upload'"

# Check for errors
ssh BAP "tail -f /mnt/basny-data/nginx/logs/error.log"
```

### R2/Cloudflare Storage

```bash
# Check storage usage (if AWS CLI configured for R2)
aws s3 ls s3://your-bucket-name/ --recursive --summarize | tail -5
```

## Alert Conditions

### 🚨 Critical Issues (Act Immediately)

1. **Out of Memory (OOM) crashes**
   ```bash
   ssh BAP "sudo docker logs basny-app | grep -i 'out of memory\|killed'"
   ```

2. **Repeated upload failures**
   ```bash
   ssh BAP "sudo docker logs basny-app | grep -c 'Upload failed'"
   ```
   If count > 10 in short period, investigate

3. **Nginx 5xx errors**
   ```bash
   ssh BAP "grep ' 5[0-9][0-9] ' /mnt/basny-data/nginx/logs/access.log | tail -20"
   ```

### ⚠️ Warning Conditions (Monitor Closely)

1. **Slow processing (>5s)**
   ```bash
   ssh BAP "sudo docker logs basny-app | grep 'Processed image' | grep -E '[5-9][0-9]{3}ms'"
   ```

2. **High memory usage (>70%)**
   ```bash
   ssh BAP "sudo docker stats basny-app --no-stream | awk 'NR==2 {print \$7}'"
   ```

3. **Disk space low (<10GB free)**
   ```bash
   ssh BAP "df -h /mnt/basny-data"
   ```

## Performance Baselines

### Expected Metrics (from stress test)

| Metric | Expected | Alert If |
|--------|----------|----------|
| Processing time | ~50ms | >5000ms |
| Memory per upload | <10MB | >100MB |
| Concurrent uploads | 5+ safe | Any crashes |
| File size | Up to 20MB | N/A |
| Success rate | >99% | <95% |

### Image Processing

```bash
# Extract processing times from logs
ssh BAP "sudo docker logs basny-app | grep 'Processed image' | tail -50"
```

Should see lines like:
```
[INFO] Processed image in 45ms { originalSize: 4567890, processedSize: 18950, format: 'jpeg' }
```

## Rollback Plan

If you see critical issues:

### Quick Rollback

```bash
# Revert to previous commit
ssh BAP "cd /opt/basny && git log --oneline -5"
ssh BAP "cd /opt/basny && git reset --hard <previous-commit-hash>"
ssh BAP "sudo docker-compose -f docker-compose.prod.yml up -d"
```

### Restore Old Nginx Config

```bash
# Get backup of old config
ssh BAP "sudo cp /opt/basny/nginx/conf.d/default.conf /tmp/default.conf.backup"

# Manually edit to restore 52M limit
ssh BAP "sudo vi /opt/basny/nginx/conf.d/default.conf"

# Change line 95: client_max_body_size 110M;
# Back to:          client_max_body_size 52M;

ssh BAP "sudo docker exec basny-nginx nginx -t && sudo docker exec basny-nginx nginx -s reload"
```

## Success Metrics

After 24-48 hours, verify:

- ✅ No OOM crashes
- ✅ No increase in error rates
- ✅ Processing times remain fast (<5s average)
- ✅ Memory usage stable
- ✅ Users successfully uploading iPhone photos
- ✅ No complaints about upload failures

## Testing with Real Images

### Option 1: Use Your iPhone

1. Take photos with iPhone
2. Test different scenarios:
   - Single photo
   - Multiple photos (5 at once)
   - Mix of sizes
   - During peak usage hours

### Option 2: Download High-Res Test Images

**NASA Image Library** (public domain):
```bash
# Apollo 11 high-res
wget https://images.nasa.gov/details/as11-40-5903 -O nasa-moon.jpg

# Mars Perseverance
wget https://images.nasa.gov/details/PIA23764 -O nasa-mars.jpg
```

**The MET Museum** (CC0 images):
```bash
# High-res artwork
wget https://collectionapi.metmuseum.org/api/collection/v1/iiif/436532/1001482/full/full/0/default.jpg -O met-artwork.jpg
```

**Internet Archive** (public domain):
```bash
# High-resolution scans
wget https://archive.org/download/high-res-photo/sample-20mb.jpg -O test-20mb.jpg
```

## Monitoring Dashboard (Optional)

If you want continuous monitoring, consider:

1. **Application metrics:**
   - Add Prometheus/Grafana
   - Monitor upload endpoint latency
   - Track memory/CPU usage

2. **Log aggregation:**
   - Set up log shipping to CloudWatch/Datadog
   - Alert on error patterns

3. **Uptime monitoring:**
   - Use service like UptimeRobot
   - Monitor /health endpoint

## Questions to Answer During Monitoring

- [ ] Are iPhone 17 photos uploading successfully?
- [ ] Is processing time acceptable (<5s)?
- [ ] Is memory usage stable?
- [ ] Are there any error spikes?
- [ ] Is disk space adequate?
- [ ] Are users reporting any issues?

---

**Remember:** The stress test showed the system can handle these limits safely. The goal of production monitoring is to verify this holds true with real-world usage patterns.
