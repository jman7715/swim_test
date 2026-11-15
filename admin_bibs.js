const express = require('express');
const router = express.Router();
const supabase = require('./supabase');

/**
 * 📌 1. 관리자 배번 및 시간 관리 화면 (GET /admin/bibs)
 * - 수파베이스에서 선수 데이터를 불러와 관리자 전용 UI 렌더링
 * - 관리자 대시보드 및 홈으로 이동하는 네비게이션 버튼 포함
 */
router.get('/', async (req, res) => {
    try {
        // 수파베이스 'swimmers' 테이블에서 데이터 조회 (등록순서 id 기준 오름차순)
        const { data: swimmers, error } = await supabase
            .from('swimmers')
            .select('*')
            .order('id', { ascending: true });

        if (error) {
            console.error("선수 데이터 조회 오류:", error);
            return res.send("<script>alert('데이터를 불러오는 중 오류가 발생했습니다.'); history.back();</script>");
        }

        // HTML 템플릿 생성
        res.send(`
            <!DOCTYPE html>
            <html lang="ko">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>관리자 - 배번 및 경기시간 관리</title>
                <link rel="stylesheet" href="/style.css">
                <style>
                    body { font-family: 'Malgun Gothic', sans-serif; background: #f4f6f9; margin: 0; padding: 20px; }
                    .admin-container { max-width: 1400px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); }
                    h2 { margin-top: 0; color: #333; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; }
                    .nav-buttons { display: flex; gap: 8px; }
                    .top-bar { display: flex; gap: 15px; align-items: center; background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 20px; flex-wrap: wrap; }
                    .filter-group { display: flex; gap: 10px; align-items: center; }
                    table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 14px; }
                    th, td { border: 1px solid #ddd; padding: 10px; text-align: center; }
                    th { background-color: #007BFF; color: white; }
                    tr:nth-child(even) { background-color: #f9f9f9; }
                    input[type="text"], select { padding: 6px; border: 1px solid #ccc; border-radius: 4px; text-align: center; }
                    .duplicate-bib { background-color: #ffcccc !important; border: 2px solid #dc3545 !important; }
                    .btn { padding: 8px 15px; background: #007BFF; color: white; border: none; border-radius: 5px; cursor: pointer; font-weight: bold; text-decoration: none; display: inline-block; font-size: 14px; }
                    .btn:hover { background: #0056b3; }
                    .btn-success { background: #28a745; }
                    .btn-success:hover { background: #218838; }
                    .btn-secondary { background: #6c757d; }
                    .btn-secondary:hover { background: #5a6268; }
                    .btn:disabled { background: #ccc; cursor: not-allowed; }
                </style>
            </head>
            <body>
                <div class="admin-container">
                    <h2>
                        <span>참가자 배번 및 경기 시간 관리</span>
                        <div class="nav-buttons">
                            <a href="/admin" class="btn btn-secondary">관리자 대시보드</a>
                            <button type="button" class="btn btn-success" onclick="saveAllChanges()">변경사항 저장</button>
                            <a href="/" class="btn btn-secondary">홈으로</a>
                        </div>
                    </h2>

                    <!-- 상단 제어 바 (필터 및 일괄 배번 부여) -->
                    <div class="top-bar">
                        <div class="filter-group">
                            <label><input type="checkbox" id="filter-paid" checked onchange="filterAndRender()"> 입금완료/무료출전만 보기</label>
                        </div>
                        <div class="filter-group" style="margin-left: auto;">
                            <label>시작 배번: <input type="text" id="start-bib-input" value="101" style="width: 80px;"></label>
                            <button type="button" class="btn" onclick="autoAssignBibs()">연속 배번 일괄 부여</button>
                        </div>
                        <div>
                            <span>조회된 선수: <strong id="filtered-count">0</strong>명</span>
                        </div>
                    </div>

                    <!-- 선수 관리 테이블 -->
                    <form id="admin-form">
                        <table>
                            <thead>
                                <tr>
                                    <th>등록순서(id)</th>
                                    <th>이름</th>
                                    <th>소속클럽</th>
                                    <th>참가비현황</th>
                                    <th>희망종목</th>
                                    <th>예상기록</th>
                                    <th>경기(입수)시간</th>
                                    <th>동의상태 (agree_status)</th>
                                    <th>등번호 (bib_no)</th>
                                </tr>
                            </thead>
                            <tbody id="player-table-body">
                                <!-- 자바스크립트로 동적 렌더링 -->
                            </tbody>
                        </table>
                    </form>
                </div>

                <script>
                    let swimmersData = ${JSON.stringify(swimmers || [])};

                    // 📌 예상기록 텍스트('1:23:45')를 초 단위로 환산
                    function parseTimeToSeconds(timeStr) {
                        if (!timeStr || typeof timeStr !== 'string') return 999999;
                        const parts = timeStr.split(':').map(Number);
                        if (parts.length === 3) {
                            return parts[0] * 3600 + parts[1] * 60 + parts[2];
                        } else if (parts.length === 2) {
                            return parts[0] * 60 + parts[1];
                        }
                        return 999999;
                    }

                    // 📌 화면 렌더링 및 필터링
                    function filterAndRender() {
                        const onlyPaid = document.getElementById('filter-paid').checked;
                        const tbody = document.getElementById('player-table-body');
                        tbody.innerHTML = '';

                        let filtered = swimmersData.filter(p => {
                            if (!onlyPaid) return true;
                            const status = (p.entry_fee_status || '').trim();
                            return status === '입금완료' || status === '무료출전';
                        });

                        filtered.sort((a, b) => parseTimeToSeconds(a.expected_time) - parseTimeToSeconds(b.expected_time));

                        document.getElementById('filtered-count').innerText = filtered.length;

                        if (filtered.length === 0) {
                            tbody.innerHTML = '<tr><td colspan="9" style="padding: 30px; color: #777;">조건에 일치하는 선수가 없습니다.</td></tr>';
                            return;
                        }

                        filtered.forEach((p) => {
                            const tr = document.createElement('tr');
                            tr.innerHTML = \`
                                <td>\${p.id}</td>
                                <td><strong>\${p.name || ''}</strong></td>
                                <td>\${p.club || ''}</td>
                                <td>\${p.entry_fee_status || '미확인'}</td>
                                <td>\${p.desired_event || ''}</td>
                                <td>\${p.expected_time || ''}</td>
                                <td><input type="text" name="entry_time_\${p.id}" value="\${p.entry_time || ''}" placeholder="예: 09:00" style="width: 100px;"></td>
                                <td>
                                    <select name="agree_status_\${p.id}">
                                        <option value="미확인" \${p.agree_status === '미확인' ? 'selected' : ''}>미확인</option>
                                        <option value="환영" \${p.agree_status === '환영' ? 'selected' : ''}>환영</option>
                                        <option value="동의" \${p.agree_status === '동의' ? 'selected' : ''}>동의</option>
                                        <option value="미동의" \${p.agree_status === '미동의' ? 'selected' : ''}>미동의</option>
                                    </select>
                                </td>
                                <td><input type="text" name="bib_no_\${p.id}" value="\${p.bib_no || ''}" data-id="\${p.id}" class="bib-input" style="width: 80px;" oninput="checkDuplicateBibs()"></td>
                            \`;
                            tbody.appendChild(tr);
                        });

                        checkDuplicateBibs();
                    }

                    // 📌 연속 배번 일괄 부여
                    function autoAssignBibs() {
                        const startInput = document.getElementById('start-bib-input').value.trim();
                        let currentBib = parseInt(startInput, 10);

                        if (isNaN(currentBib)) {
                            alert('올바른 시작 배번 숫자를 입력해주세요.');
                            return;
                        }

                        const bibInputs = document.querySelectorAll('.bib-input');
                        bibInputs.forEach(input => {
                            input.value = currentBib++;
                        });

                        checkDuplicateBibs();
                    }

                    // 📌 실시간 중복 배번 감지 및 저장 차단
                    function checkDuplicateBibs() {
                        const bibInputs = document.querySelectorAll('.bib-input');
                        const valueMap = {};

                        bibInputs.forEach(input => {
                            const val = input.value.trim();
                            if (val !== '') {
                                valueMap[val] = (valueMap[val] || 0) + 1;
                            }
                        });

                        let hasDuplicate = false;

                        bibInputs.forEach(input => {
                            const val = input.value.trim();
                            if (val !== '' && valueMap[val] > 1) {
                                input.classList.add('duplicate-bib');
                                hasDuplicate = true;
                            } else {
                                input.classList.remove('duplicate-bib');
                            }
                        });

                        const saveBtn = document.querySelector('.btn-success');
                        if (hasDuplicate) {
                            saveBtn.disabled = true;
                            saveBtn.innerText = '중복 배번 존재 (저장 불가)';
                            saveBtn.style.background = '#dc3545';
                        } else {
                            saveBtn.disabled = false;
                            saveBtn.innerText = '변경사항 저장';
                            saveBtn.style.background = '#28a745';
                        }
                    }

                    // 📌 변경사항 저장 요청
                    async function saveAllChanges() {
                        if (!confirm('현재 입력된 배번 및 시간, 동의 상태를 저장하시겠습니까?')) return;

                        const rows = document.querySelectorAll('#player-table-body tr');
                        const updates = [];

                        rows.forEach(tr => {
                            const bibInput = tr.querySelector('.bib-input');
                            if (!bibInput) return;

                            const id = bibInput.getAttribute('data-id');
                            const bib_no = bibInput.value.trim();
                            const entry_time = tr.querySelector(\`input[name="entry_time_\${id}"]\`).value.trim();
                            const agree_status = tr.querySelector(\`select[name="agree_status_\${id}"]\`).value;

                            updates.push({
                                id: parseInt(id, 10),
                                bib_no: bib_no !== '' ? parseInt(bib_no, 10) : null,
                                entry_time: entry_time,
                                agree_status: agree_status
                            });
                        });

                        try {
                            const response = await fetch('/admin/bibs/update', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ updates })
                            });

                            const result = await response.json();
                            if (result.success) {
                                alert('성공적으로 저장되었습니다!');
                                location.reload();
                            } else {
                                alert('저장 실패: ' + (result.message || '알 수 없는 오류'));
                            }
                        } catch (err) {
                            console.error('저장 중 통신 오류:', err);
                            alert('서버와 통신 중 오류가 발생했습니다.');
                        }
                    }

                    window.onload = function() {
                        filterAndRender();
                    };
                </script>
            </body>
            </html>
        `);
    } catch (err) {
        console.error("관리자 배번 페이지 로드 오류:", err);
        res.status(500).send("서버 오류가 발생했습니다.");
    }
});

/**
 * 📌 2. 변경된 선수 데이터 일괄 업데이트 API (POST /admin/bibs/update)
 */
router.post('/update', async (req, res) => {
    try {
        const { updates } = req.body;

        if (!Array.isArray(updates) || updates.length === 0) {
            return res.json({ success: false, message: '업데이트할 데이터가 없습니다.' });
        }

        // 백엔드 중복 검증 안전장치
        const bibSet = new Set();
        for (let item of updates) {
            if (item.bib_no !== null && item.bib_no !== undefined && item.bib_no !== '') {
                if (bibSet.has(item.bib_no)) {
                    return res.json({ success: false, message: `중복된 배번(${item.bib_no})이 존재하여 저장이 차단되었습니다.` });
                }
                bibSet.add(item.bib_no);
            }
        }

        for (let item of updates) {
            const { error } = await supabase
                .from('swimmers')
                .update({
                    bib_no: item.bib_no,
                    entry_time: item.entry_time,
                    agree_status: item.agree_status,
                    updated_at_custom: new Date().toISOString()
                })
                .eq('id', item.id);

            if (error) {
                console.error(`ID ${item.id} 업데이트 실패:`, error);
                return res.json({ success: false, message: `ID ${item.id} 업데이트 중 오류 발생` });
            }
        }

        res.json({ success: true });
    } catch (err) {
        console.error("업데이트 처리 서버 오류:", err);
        res.json({ success: false, message: '서버 내부 오류가 발생했습니다.' });
    }
});

module.exports = router;