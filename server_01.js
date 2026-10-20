const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// 공통 미들웨어 설정
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// 라우터 연결
const ticketRouter = require('./ticket');             // 1. 참가 접수
const playerCheckRouter = require('./player_check');   // 2. 조회 및 수정

app.use('/register', ticketRouter);
app.use('/entry', playerCheckRouter);

// 추후 구현할 라우터들 (구현 시 주석 해제)
const bibRouter = require('./player_bib');      // 배번공지 연결
app.use('/bib', bibRouter);                     // 배번공지 연결
// const adminRouter = require('./admin');
// app.use('/admin', adminRouter);

// 메인 홈 화면 (접수 기간에 따른 버튼 제어)
app.get('/', (req, res) => {
    const startDate = new Date('2026-10-01T00:00:00'); // 접수 시작일
    const endDate = new Date('2026-10-31T23:59:59');   // 접수 마감일
    const now = new Date();                            // 현재 시간

    const isRegistrationOpen = now >= startDate && now <= endDate;

    res.send(`
        <!DOCTYPE html>
        <html lang="ko">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>2026 아쿠아 마라톤 대회</title>
            <link rel="stylesheet" href="/style.css">
            <style>
                .home-container {
                    max-width: 600px;
                    margin: 50px auto;
                    background: white;
                    padding: 40px 20px;
                    border-radius: 12px;
                    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.08);
                    text-align: center;
                }
                .menu-btn {
                    display: block;
                    width: 100%;
                    height: 75px;
                    line-height: 75px;
                    background-color: #007BFF;
                    color: white;
                    text-decoration: none;
                    border-radius: 10px;
                    font-size: 26px;
                    font-weight: bold;
                    margin-bottom: 20px;
                    box-sizing: border-box;
                }
                .menu-btn:active {
                    background-color: #0056b3;
                }
                .menu-btn.disabled {
                    background-color: #ccc;
                    color: #666;
                    cursor: not-allowed;
                    pointer-events: none;
                }
                .period-info {
                    margin-bottom: 30px;
                    font-size: 20px;
                    color: #555;
                    background: #f8f9fa;
                    padding: 15px;
                    border-radius: 8px;
                }
                .admin-link {
                    margin-top: 40px;
                    font-size: 16px;
                }
                .admin-link a {
                    color: #6c757d;
                    text-decoration: none;
                }
                .admin-link a:hover {
                    text-decoration: underline;
                }
            </style>
        </head>
        <body>
            <div class="home-container">
                <h2>2026 아쿠아 마라톤 대회</h2>
                
                <div class="period-info">
                    <strong>접수 기간:</strong> 2026.10.01 ~ 2026.10.31<br>
                    <span style="color: ${isRegistrationOpen ? '#28a745' : '#dc3545'}; font-weight: bold;">
                        [ 현재 상태: ${isRegistrationOpen ? '접수 진행 중입니다' : '접수가 마감되었습니다'} ]
                    </span>
                </div>

                <a href="/register" class="menu-btn ${isRegistrationOpen ? '' : 'disabled'}">
                    1. 참가 접수하기
                </a>

                <a href="/entry" class="menu-btn">
                    2. 등록상황 확인 및 수정
                </a>

                <a href="/bib" class="menu-btn ${!isRegistrationOpen ? '' : 'disabled'}">
                    3. 배번(레인/조) 공지 확인
                </a>

                <div class="admin-link">
                    <a href="/admin">관리자 로그인</a>
                </div>
            </div>
        </body>
        </html>
    `);
});

app.listen(PORT, () => {
    console.log(`메인 서버가 실행되었습니다: http://localhost:${PORT}`);
});