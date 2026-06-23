# Production Upload Monitoring Guide

## Pre-Deployment Checklist

Before deploying the new upload limits to production:

- [x] Local stress test passed (22/22 tests)
- [x] CI tests passing
- [ ] Deploy to staging, then production
- [ ] Test with real device
- [ ] Monitor for 24-48 hours

> The upload body-size limit is enforced by the application (and Fly's own
> request handling), not by an nginx `client_max_body_size` — there is no nginx
> in prod. fly-proxy handles TLS and routing. See
> [`docs/INFRASTRUCTURE.md`](docs/INFRASTRUCTURE.md).

## Deployment Steps

Full runbook in [`docs/DEPLOY.md`](docs/DEPLOY.md). Deploy to staging first, then
prod.

### 1. Deploy Application

```bash
# Staging first
flyctl deploy --config fly.staging.toml --app basny-bap-staging

# Then production
flyctl deploy --app basny-bap
```

### 2. Verify Deployment

```bash
# Confirm the running release and that health checks pass
flyctl status --app basny-bap

# HTTP health endpoint (200 = good)
curl -sf https://bap.basny.org/health

# Tail logs for ~1 minute
flyctl logs --app basny-bap
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
flyctl logs --app basny-bap | grep -i 'image\|upload\|process'
```

Look for log messages like:
```
[INFO] Processed image in XXXms { originalSize: XXXXX, processedSize: XXXXX, format: 'jpeg' }
[INFO] Image uploaded successfully { memberId: X, submissionId: X, key: '...', size: XXXXX }
```

## Performance Monitoring

### CPU and Memory Usage

```bash
# Check machine state and resource sizing
flyctl machine status --app basny-bap
```

The machine is `shared-cpu-1x` @ 2GB RAM (see `docs/INFRASTRUCTURE.md`). For
live CPU/memory graphs, use the Fly dashboard metrics for `basny-bap`.

**What to watch:**
- **CPU** - Should spike briefly during uploads, then drop
- **Memory** - Should stay well under the 2GB machine limit
- **Memory %** - Watch for sustained high usage (>70%)

### Application Logs

fly-proxy logs requests alongside the app's own output, so `flyctl logs` covers
both request-level and application-level events.

```bash
# Watch for errors
flyctl logs --app basny-bap | grep -i error

# Watch image processing
flyctl logs --app basny-bap | grep 'Processed image'

# Watch upload completions
flyctl logs --app basny-bap | grep 'Image uploaded successfully'

# Watch upload requests at the proxy/app level
flyctl logs --app basny-bap | grep -E 'POST.*/upload'
```

### R2/Cloudflare Storage

Image uploads land in the Cloudflare R2 bucket `basny-bap-data` (see
`docs/INFRASTRUCTURE.md`). Inspect usage via the Cloudflare dashboard, or with
`rclone` configured against the R2 endpoint:

```bash
# Example with an rclone remote pointed at R2
rclone size r2:basny-bap-data
```

## Alert Conditions

### 🚨 Critical Issues (Act Immediately)

1. **Out of Memory (OOM) crashes**
   ```bash
   flyctl logs --app basny-bap | grep -i 'out of memory\|killed'
   ```

2. **Repeated upload failures**
   ```bash
   flyctl logs --app basny-bap | grep -c 'Upload failed'
   ```
   If count > 10 in short period, investigate

3. **5xx errors**
   ```bash
   flyctl logs --app basny-bap | grep -E ' 5[0-9][0-9] '
   ```

### ⚠️ Warning Conditions (Monitor Closely)

1. **Slow processing (>5s)**
   ```bash
   flyctl logs --app basny-bap | grep 'Processed image' | grep -E '[5-9][0-9]{3}ms'
   ```

2. **High memory usage (>70%)**
   ```bash
   flyctl machine status --app basny-bap
   ```
   For a running graph, use the Fly dashboard metrics for `basny-bap`.

3. **Volume space low**
   ```bash
   flyctl ssh console --app basny-bap -C "df -h /mnt/app-data"
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
flyctl logs --app basny-bap | grep 'Processed image' | tail -50
```

Should see lines like:
```
[INFO] Processed image in 45ms { originalSize: 4567890, processedSize: 18950, format: 'jpeg' }
```

## Rollback Plan

If you see critical issues, roll back to the previous Fly release. Fly keeps
prior releases (details in [`docs/DEPLOY.md`](docs/DEPLOY.md)).

### Quick Rollback

```bash
# Find the previous version number
flyctl releases --app basny-bap

# Roll back to it
flyctl releases rollback <version> --app basny-bap
```

The previous machine version stays healthy until a new release is promoted, so a
rollback simply re-points traffic at the known-good image. Verify with:

```bash
flyctl status --app basny-bap
curl -sf https://bap.basny.org/health
```

Since the upload limit lives in application code (no nginx), reverting the
release reverts the limit — there is no separate proxy config to restore.

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
   - Ship `flyctl logs` output to a log service (e.g. Datadog)
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
