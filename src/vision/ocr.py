# import pytesseract
# from PIL import Image

# img = Image.open("src/vision/templates/cs2/Full_Template.jpg")
# cropped = img.crop((195, 130, 420, 230))
# text = pytesseract.image_to_string(cropped)
# print(text)
import pytesseract
from PIL import Image

img = Image.open("src/vision/templates/cs2/Full_Template.jpg")
print(f"Image size: {img.size}")