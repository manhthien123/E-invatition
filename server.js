const express = require('express');
const multer = require('multer');
const session = require('express-session');
const fs = require('fs');
const path = require('path');
const app = express();

// Khởi tạo thư mục và file dữ liệu
if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');
const DATA_FILE = './data.json';

// Hàm đọc dữ liệu (Cấu trúc mới: { meetings: { "id1": {...}, "id2": {...} } })
const readData = () => {
    if (!fs.existsSync(DATA_FILE)) return { meetings: {} };
    try {
        const content = fs.readFileSync(DATA_FILE, 'utf8');
        return JSON.parse(content);
    } catch (e) {
        return { meetings: {} };
    }
};
const saveData = (data) => fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cấu hình Session
app.use(session({
    secret: 'nas-secret-key-123',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 3600000 }
}));

// Middleware bảo vệ Admin
const auth = (req, res, next) => req.session.isAdmin ? next() : res.status(403).json({ error: 'Unauthorized' });

// --- CÁC ROUTE GIAO DIỆN ---

// Chuyển hướng link mời họp (Vd: /meeting/abc123) sang trang index
app.get('/meeting/:id', (req, res) => {
    res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.get('/admin.html', (req, res) => {
    if (req.session && req.session.isAdmin) {
        res.sendFile(path.join(__dirname, 'public/admin.html'));
    } else {
        res.redirect('/login.html');
    }
});

// Xem PDF trực tiếp
app.get('/view-pdf/:filename', (req, res) => {
    const filePath = path.join(__dirname, 'uploads', req.params.filename);
    if (fs.existsSync(filePath)) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'inline');
        fs.createReadStream(filePath).pipe(res);
    } else {
        res.status(404).send('Không tìm thấy tài liệu!');
    }
});

// --- CÁC API HỆ THỐNG ---

// API Login
app.post('/api/login', (req, res) => {
    if (req.body.password === 'admin123') {
        req.session.isAdmin = true;
        res.json({ success: true });
    } else res.status(401).json({ success: false });
});

// 1. API Tạo cuộc họp mới (Sinh ID ngẫu nhiên)
app.post('/api/create-meeting', auth, (req, res) => {
    let data = readData();
    const newID = Math.random().toString(36).substring(2, 8); // Tạo mã 6 ký tự ngẫu nhiên
    data.meetings[newID] = {
        title: "Cuộc họp mới",
        time: "",
        members: "",
        location: "",
        files: []
    };
    saveData(data);
    res.json({ success: true, id: newID });
});

// 2. API lấy dữ liệu theo ID (Dùng cho trang chủ khi truy cập link mời)
app.get('/api/data/:id', (req, res) => {
    const data = readData();
    const meeting = data.meetings[req.params.id];
    if (meeting) res.json(meeting);
    else res.status(404).json({ error: "Không tìm thấy cuộc họp" });
});

// 3. API cập nhật thông tin theo ID
app.post('/api/update-info/:id', auth, (req, res) => {
    const { id } = req.params;
    let data = readData();
    if (data.meetings[id]) {
        Object.assign(data.meetings[id], req.body);
        saveData(data);
        res.json({ success: true });
    } else res.status(404).json({ error: "ID không tồn tại" });
});

// 4. API Upload file theo ID
const upload = multer({ dest: 'uploads/' });
app.post('/api/upload/:id', auth, upload.single('file'), (req, res) => {
    const { id } = req.params;
    let data = readData();
    if (data.meetings[id]) {
        const fileInfo = {
            name: req.body.displayName || req.file.originalname,
            path: `/view-pdf/${req.file.filename}`, // Dùng route xem trực tiếp
            category: req.body.category,
            realPath: req.file.filename // Lưu để phục vụ việc xóa
        };
        data.meetings[id].files.push(fileInfo);
        saveData(data);
        res.json({ success: true });
    } else res.status(404).json({ error: "ID không tồn tại" });
});

// 5. API Xóa file theo ID
app.post('/api/delete-file/:id', auth, (req, res) => {
    const { id } = req.params;
    const { fileName } = req.body; // filename thực tế trong thư mục uploads
    let data = readData();

    if (data.meetings[id]) {
        const absolutePath = path.join(__dirname, 'uploads', fileName);
        if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);

        data.meetings[id].files = data.meetings[id].files.filter(f => !f.path.includes(fileName));
        saveData(data);
        res.json({ success: true });
    } else res.status(404).json({ error: "Không tìm thấy" });
});

app.use(express.static('public'));

app.listen(3000, '0.0.0.0', () => console.log('Server is running at http://localhost:3000'));