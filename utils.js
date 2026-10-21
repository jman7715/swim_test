// utils.js

/**
 * 📌 한국 표준시(KST) 현재 시간을 반환하는 함수
 */
function getKSTDate() {
    const now = new Date();
    // UTC 시간에 9시간을 더해 KST 시간 계산
    const utc = now.getTime() + (now.getTimec ? now.getTimec() : now.getTimezoneOffset() * 60000);
    const kstOffset = 9 * 60 * 60 * 1000;
    return new Date(utc + kstOffset);
}


/**
 * 📌 주민등록번호 유효성(체크섬 및 생년월일) 검증 함수 (새로 추가된 부분)
 * @param {string} rawId - 하이픈이 없는 숫자 13자리 주민등록번호
 * @returns {boolean} - 유효한 번호이면 true, 가짜/오류 번호이면 false
 */
function validateRRN(rawId) {
    // 1. 숫자로만 이루어진 13자리인지 확인
    if (!/^\d{13}$/.test(rawId)) {
        return false;
    }

    // 2. 생년월일 유효성 검사 (앞 6자리)
    const yy = parseInt(rawId.substring(0, 2), 10);
    const mm = parseInt(rawId.substring(2, 4), 10);
    const dd = parseInt(rawId.substring(4, 6), 10);
    const genderDigit = parseInt(rawId.substring(6, 7), 10);

    // 성별 구분 코드는 1~8 사이여야 함
    if (genderDigit < 1 || genderDigit > 8) {
        return false;
    }

    // 월, 일 범위 체크
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) {
        return false;
    }

    // 3. 주민등록번호 체크섬 공식 검증 (가중치 계산)
    const weights = [2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5];
    let sum = 0;

    for (let i = 0; i < 12; i++) {
        sum += parseInt(rawId.charAt(i), 10) * weights[i];
    }

    const remainder = sum % 11;
    const checkSum = 11 - remainder;
    const finalCheck = checkSum >= 10 ? checkSum % 10 : checkSum;

    // 마지막 자리 번호와 계산된 값이 일치하는지 확인
    const lastDigit = parseInt(rawId.charAt(12), 10);
    return finalCheck === lastDigit;
}

// 📌 두 함수 모두 외부(다른 파일)에서 쓸 수 있도록 내보내기
module.exports = {
    getKSTDate,
    validateRRN
};
