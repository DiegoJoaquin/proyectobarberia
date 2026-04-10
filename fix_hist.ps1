$path = 'c:\Users\Diego\OneDrive\Escritorio\proyectobarberia\proyectobarberia\admin.html'
$lines = Get-Content $path -Encoding UTF8

# Replace lines 2794-2803 (0-indexed: 2793-2802) with new content
$newElseBlock = @(
'                  if (cId) {',
'                      document.querySelector(''button[data-tab="crm"]'').click();',
'                      setTimeout(() => { if(window.openClientProfile) window.openClientProfile(cId); }, 200);',
'                  } else {',
'                      // No hay ficha en CRM - abrir perfil igual con datos del booking',
'                      if (window.openClientProfile) {',
'                          window.openClientProfile(null, {',
'                              name: booking.name || ''Sin nombre'',',
'                              phone: booking.phone || '''',',
'                              rut: booking.rut || '''',',
'                              email: booking.email || '''',',
'                              total_visits: null,',
'                              points: null,',
'                              _noRecord: true',
'                          });',
'                      }',
'                  }'
)

# Verify what we are replacing (lines 2791-2804, 0-indexed 2790-2803)
Write-Host "=== BEFORE ==="
$lines[2790..2803] | ForEach-Object { Write-Host $_ }

# Build new array
$before = $lines[0..2789]
$after  = $lines[2804..($lines.Length - 1)]
$newLines = $before + $newElseBlock + $after

Set-Content $path $newLines -Encoding UTF8
Write-Host "`n=== AFTER (new block) ==="
(Get-Content $path -Encoding UTF8)[2790..2806] | ForEach-Object { Write-Host $_ }
