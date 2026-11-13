const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

// 📌 수파베이스 클라이언트 연결 설정
const supabase = require('./supabase');

/**
 * 📌 config.json 파일에서 모든 관리자 목록을 읽어오는 함수
 */
function getAllAdminConfigs() {
    try {
        const filePath = path.join(__dirname, 'config.json');
        if (!fs.existsSync(filePath)) return [];
        const fileData = fs.readFileSync(filePath, 'utf8');
        const row = JSON.parse(fileData);

        const admins = row['admins'] || [];
        return admins.map(admin => ({
            adminName: String(admin['adminName'] || '').trim(),
            adminPassword: String(admin['adminPassword'] || '').trim(),
            adminAuth: String(admin['adminAuth'] || '보기').trim()
        })).filter(admin => admin.adminName !== '');
    } catch (error) {
        console.error("관리자 설정 config.json 읽기 오류:", error);
        return [];
    }
}

/**
 * 특정 관리자 이름으로 정보를 찾는 함수
 */
function getAdminByName(adminName) {
    const admins = getAllAdminConfigs();
    if (!adminName) return null;
    return admins.find(a => a.adminName === String(adminName).trim()) || null;
}

// [GET] /admin/bibs - 배번 관리 메인 화면
router.get('/', async (req, res) => {
    const currentAdminName = String(req.query.adminName || '').trim();
    const adminInfo = getAdminByName(currentAdminName);
    const adminAuth = adminInfo ? adminInfo.adminAuth : '보기';

    // 🔒 '배번수정' 권한이 없거나 계정이 없는 경우 대시보드로 차단 리다이렉트
    if (adminAuth !== '배번수정' || !adminInfo) {
        return res.redirect(`/admin?login=success&adminName=${encodeURIComponent(currentAdminName)}&denied=1`);
    }

    try {
        // 수파베이스에서 선수 데이터 조회 확인용
        const { data: players, error } = await supabase
            .from('swimmers')
            .select('*');

        if (error) {
            console.error("수파베이스 선수 목록 읽기 오류:", error);
        }

        const count = players ? players.length : 0;

        // 화면 이동 확인용 임시 HTML 페이지
        const html = `
            <!DOCTYPE html>
            <html lang="ko">
            <head>
                <meta charset="UTF-8">
                <title>배번 수정 및 관리</title>
                <style>
                    body { font-family: 'Noto Sans KR', sans-serif; background-color: #f4f6f9; margin: 0; padding: 40px; }
                    .container { max-width: 800px; margin: 0 auto; background: #fff; padding: 40px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); text-align: center; }
                    h1 { color: #2b8a3e; margin-bottom: 20px; font-size: 26px; }
                    p { font-size: 1.1rem; color: #495057; line-height: 1.6; }
                    .highlight { color: #2b8a3e; font-weight: bold; }
                    .back-btn { display: inline-block; margin-top: 30px; padding: 12px 25px; background-color: #495057; color: #fff; text-decoration: none; border-radius: 6px; font-weight: bold; transition: 0.2s; }
                    .back-btn:hover { background-color: #343a40; }
                </style>
            </head>
            <body>
                <div class="container">
                    <h1>🔢 배번 수정 및 관리 화면</h1>
                    <p><span class="highlight">${currentAdminName}</span> 관리자님 환영합니다. (설정 권한: <span class="highlight">${adminAuth}</span>)</p>
                    <p>수파베이스 연동 확인: 총 선수 데이터 <span class="highlight">${count}명</span> 로드 완료</p>
                    <p style="margin-top: 30px; color: #868e96; font-size: 0.95rem;">
                        ※ 화면 이동과 권한 제어 검증이 완료되었습니다.<br>
                        엑셀 형식의 다중 정렬 및 배번 자동 부여 기능은 추후 단계적으로 구현될 예정입니다.
                    </p>
                    <a href="/admin?login=success&adminName=${encodeURIComponent(currentAdminName)}" class="back-btn">⬅️ 관리자 대시보드로 돌아가기</a>
                </div>
            </body>
            </html>
        `;

        res.send(html);
    } catch (err) {
        console.error("배번 관리 페이지 로드 예외:", err);
        res.status(500).send("서버 오류가 발생했습니다.");
    }
});

module.exports = router;