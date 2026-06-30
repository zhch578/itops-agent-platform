# 7节点告警修复全闭环流程 - 测试脚本
# 用于完整测试告警 → AI诊断 → 修复命令生成 → 审批 → SSH执行 → 验证 → 文档生成 全流程
# Author: IT运维平台

$BACKEND_URL = if ($env:BACKEND_URL) { $env:BACKEND_URL } else { "http://localhost:3001" }

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  7节点告警修复全闭环 - 测试工具" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 全局变量
$global:token = $null
$global:workflowId = $null
$global:alertId = $null
$global:taskId = $null
$global:approvalId = $null

# 1. 测试后端服务健康检查
function Test-Health {
    Write-Host "[步骤 1/9] 测试后端服务健康检查..." -ForegroundColor Blue
    try {
        $response = Invoke-WebRequest -Uri "$BACKEND_URL/health" -Method Get -UseBasicParsing
        if ($response.StatusCode -eq 200) {
            Write-Host "  后端服务正常运行" -ForegroundColor Green
        } else {
            Write-Host "  后端服务响应异常 (HTTP $($response.StatusCode))" -ForegroundColor Red
            exit 1
        }
    } catch {
        Write-Host "  后端服务无法访问: $_" -ForegroundColor Red
        exit 1
    }
    Write-Host ""
}

# 2. 登录获取认证 Token
function Login {
    Write-Host "[步骤 2/9] 用户登录获取 Token..." -ForegroundColor Blue
    try {
        $payload = @{
            username = "admin"
            password = "admin"
        } | ConvertTo-Json
        
        $response = Invoke-WebRequest -Uri "$BACKEND_URL/api/auth/login" -Method Post `
            -ContentType "application/json" -Body $payload -UseBasicParsing
        
        if ($response.StatusCode -eq 200) {
            $content = $response.Content | ConvertFrom-Json
            $global:token = $content.data.token
            Write-Host "  登录成功，已获取认证 Token" -ForegroundColor Green
        } else {
            Write-Host "  登录失败 (HTTP $($response.StatusCode))" -ForegroundColor Red
            exit 1
        }
    } catch {
        Write-Host "  登录失败: $_" -ForegroundColor Red
        Write-Host "  提示：请确保 admin 用户存在且密码正确" -ForegroundColor Yellow
        exit 1
    }
    Write-Host ""
}

# 3. 查找 7节点工作流
function Find-7Node-Workflow {
    Write-Host "[步骤 3/9] 查找 7节点告警修复工作流..." -ForegroundColor Blue
    try {
        $headers = @{
            Authorization = "Bearer $global:token"
        }
        
        $response = Invoke-WebRequest -Uri "$BACKEND_URL/api/workflows" -Method Get `
            -Headers $headers -UseBasicParsing
        
        if ($response.StatusCode -eq 200) {
            $content = $response.Content | ConvertFrom-Json
            $workflows = $content.data
            
            # 查找名为 "7节点告警修复全闭环" 的工作流
            $targetWorkflow = $workflows | Where-Object { $_.name -eq "7节点告警修复全闭环" }
            
            if ($targetWorkflow) {
                $global:workflowId = $targetWorkflow.id
                Write-Host "  找到目标工作流: ID=$($global:workflowId)" -ForegroundColor Green
            } else {
                Write-Host "  未找到目标工作流，尝试查找其他可用的工作流..." -ForegroundColor Yellow
                
                # 尝试使用任何可用的工作流
                if ($workflows.Count -gt 0) {
                    $global:workflowId = $workflows[0].id
                    Write-Host "  使用备选工作流: $($workflows[0].name) ID=$($global:workflowId)" -ForegroundColor Yellow
                } else {
                    Write-Host "  没有可用的工作流！" -ForegroundColor Red
                    exit 1
                }
            }
        }
    } catch {
        Write-Host "  获取工作流失败: $_" -ForegroundColor Red
        exit 1
    }
    Write-Host ""
}

# 4. 创建模拟告警
function Create-Test-Alert {
    Write-Host "[步骤 4/9] 创建模拟告警..." -ForegroundColor Blue
    try {
        $headers = @{
            Authorization = "Bearer $global:token"
        }
        
        $alertData = @{
            source = "test"
            severity = "critical"
            title = "CPU 使用率过高测试告警"
            content = "服务器 192.168.1.100 CPU使用率持续超过95%已达5分钟，需要立即处理！"
            metadata = @{
                host = "192.168.1.100"
                tags = @("cpu", "performance", "test")
            }
        } | ConvertTo-Json -Depth 10
        
        $response = Invoke-WebRequest -Uri "$BACKEND_URL/api/alerts" -Method Post `
            -Headers $headers -ContentType "application/json" -Body $alertData -UseBasicParsing
        
        if ($response.StatusCode -eq 201) {
            $content = $response.Content | ConvertFrom-Json
            $global:alertId = $content.data.alert.id
            Write-Host "  测试告警创建成功: ID=$($global:alertId)" -ForegroundColor Green
        } else {
            Write-Host "  创建告警失败 (HTTP $($response.StatusCode))" -ForegroundColor Red
        }
    } catch {
        Write-Host "  创建告警失败: $_" -ForegroundColor Red
    }
    Write-Host ""
}

# 5. 手动触发工作流
function Start-Workflow {
    Write-Host "[步骤 5/9] 手动触发工作流执行..." -ForegroundColor Blue
    try {
        $headers = @{
            Authorization = "Bearer $global:token"
        }
        
        $taskData = @{
            workflow_id = $global:workflowId
            name = "测试 - 7节点告警修复全闭环"
            input = "模拟告警：服务器 192.168.1.100 CPU使用率过高"
            context = @{
                alert_id = $global:alertId
                test_mode = $true
            }
        } | ConvertTo-Json -Depth 10
        
        $response = Invoke-WebRequest -Uri "$BACKEND_URL/api/tasks" -Method Post `
            -Headers $headers -ContentType "application/json" -Body $taskData -UseBasicParsing
        
        if ($response.StatusCode -eq 201) {
            $content = $response.Content | ConvertFrom-Json
            $global:taskId = $content.data.taskId
            Write-Host "  工作流任务已触发: ID=$($global:taskId)" -ForegroundColor Green
        } else {
            Write-Host "  触发工作流失败 (HTTP $($response.StatusCode))" -ForegroundColor Red
        }
    } catch {
        Write-Host "  触发工作流失败: $_" -ForegroundColor Red
    }
    Write-Host ""
}

# 6. 监控任务执行（支持自动发现和通过审批）
function Monitor-Task {
    param([switch]$AutoApprove = $false)
    
    Write-Host "[步骤 6/12] 监控任务执行情况..." -ForegroundColor Blue
    Write-Host "  任务ID: $global:taskId" -ForegroundColor Yellow
    if ($AutoApprove) {
        Write-Host "  模式：自动审批模式" -ForegroundColor Cyan
    }
    Write-Host ""
    
    $maxAttempts = 60
    $attempt = 0
    $status = "pending"
    $foundApproval = $false
    
    while ($attempt -lt $maxAttempts) {
        try {
            $headers = @{
                Authorization = "Bearer $global:token"
            }
            
            $response = Invoke-WebRequest -Uri "$BACKEND_URL/api/tasks/$global:taskId" -Method Get `
                -Headers $headers -UseBasicParsing
            
            if ($response.StatusCode -eq 200) {
                $content = $response.Content | ConvertFrom-Json
                $task = $content.data
                $status = $task.status
                
                Write-Host "  [$(Get-Date -Format 'HH:mm:ss')] 任务状态: $status" -ForegroundColor $(if ($status -eq "failed") { "Red" } elseif ($status -eq "completed") { "Green" } elseif ($status -eq "waiting_approval") { "Cyan" } else { "Yellow" })
                
                # 检查是否等待审批
                if ($status -eq "waiting_approval" -and -not $foundApproval) {
                    Write-Host "  ⏸️ 工作流已暂停在审批节点" -ForegroundColor Cyan
                    
                    # 查询待审批记录
                    Get-Pending-Approvals
                    
                    if ($AutoApprove -and $global:approvalId) {
                        Auto-Approve
                        $foundApproval = $true
                    } else {
                        Write-Host "  💡 你可以通过以下方式继续：" -ForegroundColor Yellow
                        Write-Host "     1. 访问前端页面完成审批" -ForegroundColor White
                        Write-Host "     2. 继续监控，等待超时自动拒绝" -ForegroundColor White
                        Write-Host ""
                    }
                }
                
                # 任务结束
                if ($status -eq "completed" -or $status -eq "failed" -or $status -eq "cancelled") {
                    Write-Host "  任务已结束！" -ForegroundColor $(if ($status -eq "completed") { "Green" } else { "Red" })
                    break
                }
            }
        } catch {
            Write-Host "  查询任务状态失败: $_" -ForegroundColor Red
        }
        
        $attempt++
        Start-Sleep -Seconds 2
    }
    
    if ($attempt -eq $maxAttempts -and $status -ne "completed" -and $status -ne "failed" -and $status -eq "waiting_approval") {
        Write-Host "  ⏱️ 等待时间过长，你可以手动完成" -ForegroundColor Yellow
    }
    Write-Host ""
}

# 7. 手动触发告警处理
function Trigger-Alert-Processing {
    Write-Host "[步骤 7/9] 手动触发告警处理..." -ForegroundColor Blue
    try {
        $headers = @{
            Authorization = "Bearer $global:token"
        }
        
        $response = Invoke-WebRequest -Uri "$BACKEND_URL/api/alerts/$global:alertId/process" -Method Post `
            -Headers $headers -UseBasicParsing
        
        if ($response.StatusCode -eq 200) {
            $content = $response.Content | ConvertFrom-Json
            Write-Host "  告警处理已触发" -ForegroundColor Green
            
            if ($content.data.matchedPolicies.Count -gt 0) {
                Write-Host "  匹配到的修复策略:" -ForegroundColor Magenta
                $content.data.matchedPolicies | ForEach-Object {
                    Write-Host "  - $($_.name) ($($_.execution_mode))" -ForegroundColor White
                }
            }
        }
    } catch {
        Write-Host "  触发告警处理失败: $_" -ForegroundColor Red
    }
    Write-Host ""
}

# 8. 查看告警详情
function Get-Alert-Details {
    Write-Host "[步骤 8/9] 查看告警详情..." -ForegroundColor Blue
    try {
        $headers = @{
            Authorization = "Bearer $global:token"
        }
        
        $response = Invoke-WebRequest -Uri "$BACKEND_URL/api/alerts/$global:alertId" -Method Get `
            -Headers $headers -UseBasicParsing
        
        if ($response.StatusCode -eq 200) {
            $content = $response.Content | ConvertFrom-Json
            $alert = $content.data
            Write-Host "  告警标题: $($alert.title)" -ForegroundColor Yellow
            Write-Host "  告警状态: $($alert.status)" -ForegroundColor White
            Write-Host "  告警级别: $($alert.severity)" -ForegroundColor White
            Write-Host "  创建时间: $($alert.created_at)" -ForegroundColor White
            Write-Host "  告警内容: $($alert.content)" -ForegroundColor Cyan
        }
    } catch {
        Write-Host "  获取告警详情失败: $_" -ForegroundColor Red
    }
    Write-Host ""
}

# 9. 查询待审批记录
function Get-Pending-Approvals {
    Write-Host "[步骤 9/12] 查询待审批记录..." -ForegroundColor Blue
    try {
        $headers = @{
            Authorization = "Bearer $global:token"
        }
        
        $response = Invoke-WebRequest -Uri "$BACKEND_URL/api/approvals?status=pending" -Method Get `
            -Headers $headers -UseBasicParsing
        
        if ($response.StatusCode -eq 200) {
            $content = $response.Content | ConvertFrom-Json
            $approvals = $content.data
            
            if ($approvals.Count -gt 0) {
                Write-Host "  找到 $($approvals.Count) 条待审批记录" -ForegroundColor Green
                $approvals | ForEach-Object {
                    Write-Host "  - ID: $($_.id), 节点: $($_.node_label)" -ForegroundColor White
                    if ($_.task_id -eq $global:taskId) {
                        Write-Host "  ✅ 找到目标任务对应的审批记录!" -ForegroundColor Cyan
                        $global:approvalId = $_.id
                    }
                }
            } else {
                Write-Host "  没有待审批记录" -ForegroundColor Yellow
            }
        }
    } catch {
        Write-Host "  查询审批失败: $_" -ForegroundColor Red
    }
    Write-Host ""
}

# 10. 自动通过审批
function Auto-Approve {
    param([string]$apprId)
    
    Write-Host "[步骤 10/12] 自动通过审批..." -ForegroundColor Blue
    try {
        if (-not $apprId) {
            $apprId = $global:approvalId
        }
        
        if (-not $apprId) {
            Write-Host "  没有审批ID，无法自动审批" -ForegroundColor Red
            return
        }
        
        Write-Host "  正在审批 ID: $apprId" -ForegroundColor Yellow
        
        $headers = @{
            Authorization = "Bearer $global:token"
        }
        
        $approvalData = @{
            comment = "自动通过测试审批"
        } | ConvertTo-Json
        
        $response = Invoke-WebRequest -Uri "$BACKEND_URL/api/approvals/$apprId/approve" -Method Post `
            -Headers $headers -ContentType "application/json" -Body $approvalData -UseBasicParsing
        
        if ($response.StatusCode -eq 200) {
            Write-Host "  ✅ 审批通过成功!" -ForegroundColor Green
        }
    } catch {
        Write-Host "  审批失败: $_" -ForegroundColor Red
    }
    Write-Host ""
}

# 11. 继续监控任务
function Monitor-Task-After-Approval {
    Write-Host "[步骤 11/12] 继续监控任务执行..." -ForegroundColor Blue
    Monitor-Task  # 复用之前的监控函数
}

# 12. 查看生成的报告（如果有）
function Get-Reports {
    Write-Host "[步骤 12/12] 检查报告生成..." -ForegroundColor Blue
    Write-Host "  提示：如果任务执行完成，检查报告是否已生成" -ForegroundColor Yellow
    Write-Host ""
}

# 测试手动创建告警并触发工作流的流程
function Test-Manual-Workflow {
    param([switch]$AutoApprove = $false)
    
    Write-Host "✨ 开始测试手动触发工作流流程" -ForegroundColor Cyan
    if ($AutoApprove) {
        Write-Host "🔓 自动审批模式已启用" -ForegroundColor Cyan
    }
    Write-Host ""
    
    Test-Health
    Login
    Find-7Node-Workflow
    Create-Test-Alert
    Start-Workflow
    
    if ($AutoApprove) {
        Monitor-Task -AutoApprove
    } else {
        Monitor-Task
    }
    
    Get-Alert-Details
    Get-Reports
    
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "测试完成！" -ForegroundColor Green
    Write-Host ""
    Write-Host "📊 测试结果总结：" -ForegroundColor Yellow
    Write-Host "  - 告警 ID: $global:alertId" -ForegroundColor White
    Write-Host "  - 工作流 ID: $global:workflowId" -ForegroundColor White
    Write-Host "  - 任务 ID: $global:taskId" -ForegroundColor White
    if ($global:approvalId) {
        Write-Host "  - 审批 ID: $global:approvalId" -ForegroundColor White
    }
    Write-Host ""
    Write-Host "🔗 下一步你可以：" -ForegroundColor Yellow
    Write-Host "  1. 访问前端页面查看任务详情" -ForegroundColor White
    Write-Host "  2. 检查生成的报告和执行记录" -ForegroundColor White
    Write-Host "========================================" -ForegroundColor Cyan
}

# 测试告警自动匹配和处理流程
function Test-Alert-Auto-Process {
    Write-Host "✨ 开始测试告警自动处理流程" -ForegroundColor Cyan
    Write-Host ""
    
    Test-Health
    Login
    Create-Test-Alert
    Start-Sleep -Seconds 3
    Trigger-Alert-Processing
    Get-Alert-Details
    
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "告警自动处理测试完成！" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Cyan
}

# 显示帮助菜单
function Show-Help {
    Write-Host "7节点告警修复全闭环 - 测试工具使用帮助" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "可用参数：" -ForegroundColor Yellow
    Write-Host "  - ManualWorkflow : 测试手动创建告警并触发工作流（默认）" -ForegroundColor White
    Write-Host "  - AutoWorkflow   : 测试并自动通过审批" -ForegroundColor White
    Write-Host "  - AlertProcess   : 测试告警自动处理流程" -ForegroundColor White
    Write-Host "  - Help           : 显示帮助信息" -ForegroundColor White
    Write-Host ""
    Write-Host "示例：" -ForegroundColor Yellow
    Write-Host "  .\test-7-node-workflow.ps1 ManualWorkflow" -ForegroundColor White
    Write-Host "  .\test-7-node-workflow.ps1 AutoWorkflow" -ForegroundColor White
    Write-Host "  .\test-7-node-workflow.ps1 AlertProcess" -ForegroundColor White
    Write-Host ""
}

# 主程序
$param = if ($args.Count -gt 0) { $args[0] } else { "ManualWorkflow" }

switch ($param) {
    "ManualWorkflow" {
        Test-Manual-Workflow
    }
    "AutoWorkflow" {
        Test-Manual-Workflow -AutoApprove
    }
    "AlertProcess" {
        Test-Alert-Auto-Process
    }
    "Help" {
        Show-Help
    }
    default {
        Show-Help
    }
}
