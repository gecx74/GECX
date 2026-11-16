const CATEGORIES = [
    { key: 'work', label: '工作', color: '#3D6EF5', bg: '#EAF1FE' },
    { key: 'life', label: '生活', color: '#12A67C', bg: '#E3F6EE' },
];

const DEFAULT_CATEGORY = 'work';

function categoryOf(key) {
    for (let i = 0; i < CATEGORIES.length; i += 1) {
        if (CATEGORIES[i].key === key) {
            return CATEGORIES[i];
        }
    }
    return CATEGORIES[0];
}

module.exports = {
    CATEGORIES: CATEGORIES,
    DEFAULT_CATEGORY: DEFAULT_CATEGORY,
    categoryOf: categoryOf,
};
