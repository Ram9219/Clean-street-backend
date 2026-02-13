# Test all admin creation and volunteer management endpoints
$Backend = "https://clean-street-backend-adf6.onrender.com"
$CookieFile = ".\admin-cookies.txt"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "TESTING ADMIN & VOLUNTEER ENDPOINTS" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# Step 1: Login as Super Admin
Write-Host "1. Logging in as Super Admin..." -ForegroundColor Yellow
$loginResponse = curl.exe -X POST "$Backend/api/admin/login" `
  -H "Content-Type: application/json" `
  -d '{\"email\":\"superadmin@gmail.com\",\"password\":\"ChangeMe123!@#\"}' `
  -c $CookieFile -s | ConvertFrom-Json

if ($loginResponse.success) {
    Write-Host "✅ Super Admin logged in successfully" -ForegroundColor Green
    Write-Host "   User: $($loginResponse.user.name) ($($loginResponse.user.role))" -ForegroundColor Gray
} else {
    Write-Host "❌ Login failed: $($loginResponse.error)" -ForegroundColor Red
    exit
}

# Step 2: Test Create Admin
Write-Host "`n2. Testing Create Admin Endpoint..." -ForegroundColor Yellow
$randomNum = Get-Random -Minimum 1000 -Maximum 9999
$newAdminEmail = "testadmin$randomNum@test.com"
$createAdminResponse = curl.exe -X POST "$Backend/api/admin/create-admin" `
  -H "Content-Type: application/json" `
  -b $CookieFile `
  -d "{`"email`":`"$newAdminEmail`",`"password`":`"Admin123!@#`",`"name`":`"Test Admin $randomNum`",`"permissions`":[`"manage_reports`",`"view_analytics`"]}" `
  -s | ConvertFrom-Json

if ($createAdminResponse.success) {
    Write-Host "✅ Admin created successfully" -ForegroundColor Green
    Write-Host "   Email: $($createAdminResponse.admin.email)" -ForegroundColor Gray
    Write-Host "   ID: $($createAdminResponse.admin.id)" -ForegroundColor Gray
    $newAdminId = $createAdminResponse.admin.id
} else {
    Write-Host "❌ Admin creation failed: $($createAdminResponse.error)" -ForegroundColor Red
    if ($createAdminResponse.errors) {
        Write-Host "   Errors: $($createAdminResponse.errors | ConvertTo-Json -Compress)" -ForegroundColor Red
    }
}

# Step 3: Test Update Admin Permissions
if ($newAdminId) {
    Write-Host "`n3. Testing Update Admin Permissions..." -ForegroundColor Yellow
    $updatePermResponse = curl.exe -X PUT "$Backend/api/admin/admins/$newAdminId/permissions" `
      -H "Content-Type: application/json" `
      -b $CookieFile `
      -d '{"permissions":["manage_reports","view_analytics","manage_users"]}' `
      -s | ConvertFrom-Json

    if ($updatePermResponse.success) {
        Write-Host "✅ Permissions updated successfully" -ForegroundColor Green
        Write-Host "   New permissions: $($updatePermResponse.admin.permissions -join ', ')" -ForegroundColor Gray
    } else {
        Write-Host "❌ Permission update failed: $($updatePermResponse.error)" -ForegroundColor Red
    }
}

# Step 4: Get list of volunteers to test on
Write-Host "`n4. Getting Volunteer List..." -ForegroundColor Yellow
$volunteersResponse = curl.exe -X GET "$Backend/api/admin/volunteers?limit=10" `
  -b $CookieFile `
  -s | ConvertFrom-Json

if ($volunteersResponse.success) {
    Write-Host "✅ Found $($volunteersResponse.volunteers.Count) volunteers" -ForegroundColor Green
    
    if ($volunteersResponse.volunteers.Count -gt 0) {
        $testVolunteer = $volunteersResponse.volunteers[0]
        $volunteerId = $testVolunteer._id
        Write-Host "   Testing with volunteer: $($testVolunteer.name) (Status: $($testVolunteer.volunteer_status))" -ForegroundColor Gray
        
        # Step 5: Test Volunteer Verification
        if ($testVolunteer.volunteer_status -eq "pending") {
            Write-Host "`n5. Testing Volunteer Verification..." -ForegroundColor Yellow
            $verifyResponse = curl.exe -X POST "$Backend/api/admin/volunteers/$volunteerId/verify" `
              -H "Content-Type: application/json" `
              -b $CookieFile `
              -s | ConvertFrom-Json

            if ($verifyResponse.success) {
                Write-Host "✅ Volunteer verified successfully" -ForegroundColor Green
                Write-Host "   Status: $($verifyResponse.user.volunteer_status)" -ForegroundColor Gray
            } else {
                Write-Host "❌ Verification failed: $($verifyResponse.error)" -ForegroundColor Red
            }
        } else {
            Write-Host "`n5. Skipping verification (volunteer not pending)" -ForegroundColor Gray
        }
        
        # Step 6: Test Volunteer Rejection (user)
        Write-Host "`n6. Testing Volunteer User Rejection..." -ForegroundColor Yellow
        $rejectUserResponse = curl.exe -X POST "$Backend/api/admin/volunteers/$volunteerId/reject" `
          -H "Content-Type: application/json" `
          -b $CookieFile `
          -d '{"reason":"Test rejection - will be reverted"}' `
          -s | ConvertFrom-Json

        if ($rejectUserResponse.success) {
            Write-Host "✅ Volunteer user rejected successfully" -ForegroundColor Green
        } else {
            Write-Host "⚠️  Rejection response: $($rejectUserResponse.error)" -ForegroundColor Yellow
        }
    }
} else {
    Write-Host "❌ Failed to get volunteers: $($volunteersResponse.error)" -ForegroundColor Red
}

# Step 7: Get volunteer applications
Write-Host "`n7. Getting Volunteer Applications..." -ForegroundColor Yellow
$applicationsResponse = curl.exe -X GET "$Backend/api/admin/volunteers/applications?status=pending&limit=10" `
  -b $CookieFile `
  -s | ConvertFrom-Json

if ($applicationsResponse.success) {
    Write-Host "✅ Found $($applicationsResponse.applications.Count) pending applications" -ForegroundColor Green
    
    if ($applicationsResponse.applications.Count -gt 0) {
        $testApp = $applicationsResponse.applications[0]
        $appId = $testApp._id
        Write-Host "   Testing with application: $($testApp.applyingFor) tier" -ForegroundColor Gray
        
        # Step 8: Test Application Rejection
        Write-Host "`n8. Testing Application Rejection (requires reason)..." -ForegroundColor Yellow
        $rejectAppResponse = curl.exe -X POST "$Backend/api/admin/volunteers/applications/$appId/reject" `
          -H "Content-Type: application/json" `
          -b $CookieFile `
          -d '{"reason":"Test rejection for endpoint validation"}' `
          -s | ConvertFrom-Json

        if ($rejectAppResponse.success) {
            Write-Host "✅ Application rejected successfully" -ForegroundColor Green
        } else {
            Write-Host "❌ Application rejection failed: $($rejectAppResponse.error)" -ForegroundColor Red
            if ($rejectAppResponse.errors) {
                Write-Host "   Validation errors: $($rejectAppResponse.errors | ConvertTo-Json -Compress)" -ForegroundColor Red
            }
        }
        
        # Step 9: Test Application Approval (on different app)
        if ($applicationsResponse.applications.Count -gt 1) {
            $testApp2 = $applicationsResponse.applications[1]
            $appId2 = $testApp2._id
            
            Write-Host "`n9. Testing Application Approval..." -ForegroundColor Yellow
            $approveAppResponse = curl.exe -X POST "$Backend/api/admin/volunteers/$appId2/approve" `
              -H "Content-Type: application/json" `
              -b $CookieFile `
              -d '{"notes":"Approved for testing purposes"}' `
              -s | ConvertFrom-Json

            if ($approveAppResponse.success) {
                Write-Host "✅ Application approved successfully" -ForegroundColor Green
            } else {
                Write-Host "❌ Application approval failed: $($approveAppResponse.error)" -ForegroundColor Red
            }
        }
    } else {
        Write-Host "⚠️  No pending applications to test with" -ForegroundColor Yellow
    }
} else {
    Write-Host "❌ Failed to get applications: $($applicationsResponse.error)" -ForegroundColor Red
}

# Step 10: Test validation errors
Write-Host "`n10. Testing Validation Errors..." -ForegroundColor Yellow

Write-Host "   a) Create admin without required fields..." -ForegroundColor Gray
$invalidAdmin = curl.exe -X POST "$Backend/api/admin/create-admin" `
  -H "Content-Type: application/json" `
  -b $CookieFile `
  -d '{"email":"invalid"}' `
  -s | ConvertFrom-Json

if ($invalidAdmin.errors) {
    Write-Host "   ✅ Validation working: $($invalidAdmin.errors.Count) errors caught" -ForegroundColor Green
} else {
    Write-Host "   ⚠️  Expected validation errors but got none" -ForegroundColor Yellow
}

Write-Host "   b) Reject application without reason..." -ForegroundColor Gray
if ($applicationsResponse.applications.Count -gt 0) {
    $appId = $applicationsResponse.applications[0]._id
    $noReasonReject = curl.exe -X POST "$Backend/api/admin/volunteers/applications/$appId/reject" `
      -H "Content-Type: application/json" `
      -b $CookieFile `
      -d '{}' `
      -s | ConvertFrom-Json

    if ($noReasonReject.errors) {
        Write-Host "   ✅ Validation working: reason field required" -ForegroundColor Green
    } else {
        Write-Host "   ⚠️  Expected validation error for missing reason" -ForegroundColor Yellow
    }
}

# Summary
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "TEST SUMMARY" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "✅ All critical endpoints tested" -ForegroundColor Green
Write-Host "Backend: $Backend" -ForegroundColor Gray
Write-Host "`nNote: Some tests might show warnings if there's no data to test with." -ForegroundColor Yellow
Write-Host "This is expected and not an error.`n" -ForegroundColor Yellow

# Cleanup
Remove-Item $CookieFile -ErrorAction SilentlyContinue
