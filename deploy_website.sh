#!/bin/bash
################################################################################
# Crash Dash - Production Deployment
# Updates data directly on main branch (no staging/merging)
################################################################################

set -e

# Get script directory and derive paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
WEBSITE_DIR="$BASE_DIR/website"
PYTHON_BIN="$BASE_DIR/pine_env/bin/python3"

echo "================================================================================"
echo "⚡ CRASH DASH - PRODUCTION DEPLOYMENT"
echo "================================================================================"

cd "$WEBSITE_DIR"

# Always work on main branch
CURRENT_BRANCH=$(git branch --show-current)
if [ "$CURRENT_BRANCH" != "main" ]; then
    echo "⚠️  Not on main branch (current: $CURRENT_BRANCH) - switching to main..."
    git checkout main
fi

# Stash any uncommitted changes before pulling
echo ""
echo "💾 Stashing any uncommitted changes..."
git stash push -m "Auto-stash before deployment $(date '+%Y-%m-%d %H:%M:%S')" || true

# Pull latest changes from remote to avoid conflicts
echo ""
echo "🔄 Syncing with remote..."
git pull origin main --rebase || {
    echo "⚠️  Rebase conflict detected - attempting auto-resolution..."
    # Accept remote changes for data files (they're auto-generated anyway)
    git checkout --theirs data/
    git add data/
    git rebase --continue || {
        echo "❌ Could not auto-resolve - aborting rebase"
        git rebase --abort
        # Restore stashed changes
        git stash pop || true
        exit 1
    }
}

# Restore stashed changes (if any)
echo ""
echo "🔄 Restoring stashed changes..."
git stash pop || echo "ℹ️  No stashed changes to restore"

# Refresh data from production pipeline
echo ""
echo "📊 Refreshing website data..."
cd "$BASE_DIR"
$PYTHON_BIN -c "
import sys
sys.path.insert(0, '$BASE_DIR')
from prod.website_builder.prepare_data import WebsiteDataPrep
prep = WebsiteDataPrep(base_dir='$BASE_DIR')
prep.website_dir = prep.base_dir / 'website'
prep.website_data = prep.website_dir / 'data'
prep.prepare_all()
"
cd "$WEBSITE_DIR"

# Check if signals.csv actually changed (ignore timestamp-only JSON updates)
echo ""
echo "🔍 Checking for new signals..."
if git diff --quiet data/signals.csv; then
    echo "ℹ️  No new signals detected (signals.csv unchanged)"
    
    # Check if metadata JSON files changed (exclude timestamp-only changes)
    # Count lines that start with +/- but exclude timestamp fields
    METADATA_CHANGED=$(git diff data/*.json 2>/dev/null | grep '^[+-]' | grep -v '^[+-]\s*"last_updated"' | grep -v '^[+-]\s*"generated"' | grep -v '^+++' | grep -v '^---' | wc -l)
    
    if [ "$METADATA_CHANGED" -eq 0 ]; then
        echo "ℹ️  No meaningful changes (only timestamps updated) - skipping deployment"
        exit 0
    else
        echo "✅ Metadata changes detected ($METADATA_CHANGED content lines) - proceeding with deployment"
    fi
else
    echo "✅ New signals detected in signals.csv - proceeding with deployment"
fi

# Commit data changes
echo ""
echo "💾 Committing fresh data..."
git add data/
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S UTC')
git commit -m "data: Auto-update from automation - $TIMESTAMP" || {
    echo "ℹ️  No changes to commit"
    exit 0
}

# Push to GitHub (triggers GitHub Pages deploy)
echo ""
echo "🚀 Pushing to GitHub..."
git push origin main

echo ""
echo "================================================================================"
echo "✅ DEPLOYMENT COMPLETE"
echo "   • Data refreshed"
echo "   • Changes committed to main"
echo "   • Pushed to GitHub"
echo "   • GitHub Pages will auto-deploy in ~2 minutes"
echo "================================================================================"
